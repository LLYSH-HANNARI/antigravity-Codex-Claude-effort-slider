//! Windows 原生 Win32 极简安装面板（双击无参数启动时展示）。
//! 零外部 GUI 框架依赖，体积轻量且原生支持高分屏与中文。

use std::sync::{Mutex, OnceLock};
use std::thread;

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateFontW, GetStockObject, HFONT, DEFAULT_CHARSET, DEFAULT_PITCH, FF_SWISS,
    WHITE_BRUSH,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW,
    LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassExW, SendMessageW,
    SetWindowTextW, ShowWindow, TranslateMessage, BS_PUSHBUTTON, CW_USEDEFAULT,
    ES_AUTOVSCROLL, ES_MULTILINE, ES_READONLY, IDC_ARROW, MSG, SW_SHOW, WM_APP,
    WM_COMMAND, WM_CREATE, WM_DESTROY, WM_SETFONT, WNDCLASSEXW, WS_BORDER,
    WS_CAPTION, WS_CHILD, WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU, WS_VISIBLE,
    WS_VSCROLL,
};

use crate::patcher;
use crate::state::BUNDLED_VERSION;
use crate::updater;

const ID_STATUS_LABEL: usize = 101;
const ID_BTN_INSTALL: usize = 201;
const ID_BTN_UPDATE: usize = 202;
const ID_BTN_UNINSTALL: usize = 203;
const ID_BTN_REFRESH: usize = 204;
const ID_LOG_BOX: usize = 301;

const WM_APP_TASK_DONE: u32 = WM_APP + 1;

struct UiHandles {
    hwnd_main: isize,
    hwnd_status: isize,
    hwnd_log: isize,
    hwnd_btn_install: isize,
    hwnd_btn_update: isize,
    hwnd_btn_uninstall: isize,
    hwnd_btn_refresh: isize,
}

static UI_HANDLES: OnceLock<Mutex<Option<UiHandles>>> = OnceLock::new();
static PENDING_RESULT: OnceLock<Mutex<Option<(String, String)>>> = OnceLock::new();

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn set_window_text(hwnd: HWND, text: &str) {
    let wide = to_wide(text);
    unsafe {
        SetWindowTextW(hwnd, wide.as_ptr());
    }
}

fn format_status_summary() -> String {
    let st = patcher::inspect_status(None);
    let plugin_txt = if st.plugin_installed {
        format!(
            "已安装 v{}",
            st.installed_version.as_deref().unwrap_or(BUNDLED_VERSION)
        )
    } else {
        "未安装".to_string()
    };

    let desktop_txt = if st.desktop_targets.is_empty() {
        "未检测到".to_string()
    } else {
        let patched_cnt = st.desktop_targets.iter().filter(|d| d.patched).count();
        let staged_cnt = st.desktop_targets.iter().filter(|d| d.has_staged).count();
        if staged_cnt > 0 {
            format!("待退出完成替换 ({staged_cnt})")
        } else if patched_cnt == st.desktop_targets.len() {
            format!("已注入 ({patched_cnt}/{})", st.desktop_targets.len())
        } else {
            format!("未注入 ({patched_cnt}/{})", st.desktop_targets.len())
        }
    };

    let ide_txt = if st.ide_targets.is_empty() {
        "未检测到".to_string()
    } else {
        let patched_cnt = st.ide_targets.iter().filter(|d| d.patched).count();
        if patched_cnt == st.ide_targets.len() {
            format!("已注入 ({patched_cnt}/{})", st.ide_targets.len())
        } else {
            format!("未注入 ({patched_cnt}/{})", st.ide_targets.len())
        }
    };

    format!(
        "插件托管状态：{plugin_txt}  |  目录：{}\r\nDesktop 状态：{desktop_txt}  |  IDE 状态：{ide_txt}",
        st.plugin_root
    )
}

fn set_buttons_enabled(enabled: bool) {
    let val = if enabled { 1 } else { 0 };
    if let Some(lock) = UI_HANDLES.get() {
        if let Ok(guard) = lock.lock() {
            if let Some(h) = guard.as_ref() {
                unsafe {
                    EnableWindow(h.hwnd_btn_install as HWND, val);
                    EnableWindow(h.hwnd_btn_update as HWND, val);
                    EnableWindow(h.hwnd_btn_uninstall as HWND, val);
                    EnableWindow(h.hwnd_btn_refresh as HWND, val);
                }
            }
        }
    }
}

fn run_bg_task<F>(title: &str, task: F)
where
    F: FnOnce() -> String + Send + 'static,
{
    set_buttons_enabled(false);
    if let Some(lock) = UI_HANDLES.get() {
        if let Ok(guard) = lock.lock() {
            if let Some(h) = guard.as_ref() {
                set_window_text(h.hwnd_log as HWND, &format!("正在执行：{title}...\r\n请稍候..."));
            }
        }
    }

    thread::spawn(move || {
        let log_text = task();
        let status_text = format_status_summary();
        let store = PENDING_RESULT.get_or_init(|| Mutex::new(None));
        if let Ok(mut guard) = store.lock() {
            *guard = Some((status_text, log_text));
        }
        if let Some(lock) = UI_HANDLES.get() {
            if let Ok(guard) = lock.lock() {
                if let Some(h) = guard.as_ref() {
                    unsafe {
                        PostMessageW(h.hwnd_main as HWND, WM_APP_TASK_DONE, 0, 0);
                    }
                }
            }
        }
    });
}

fn format_report(report: &patcher::OperationReport) -> String {
    let mut lines = Vec::new();
    for m in &report.messages {
        lines.push(format!("• {m}"));
    }
    for e in &report.errors {
        lines.push(format!("! 错误：{e}"));
    }
    if lines.is_empty() {
        lines.push("操作完成，无变更项。".to_string());
    } else if report.ok {
        lines.push("\r\n操作成功完成！若已打开 Antigravity，重启或重载窗口即可生效。".to_string());
    }
    lines.join("\r\n")
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CREATE => {
            let hinstance = GetModuleHandleW(std::ptr::null());
            let font_name = to_wide("Microsoft YaHei UI");
            let font: HFONT = CreateFontW(
                -15,
                0,
                0,
                0,
                400,
                0,
                0,
                0,
                DEFAULT_CHARSET as u32,
                0,
                0,
                0,
                DEFAULT_PITCH as u32 | FF_SWISS as u32,
                font_name.as_ptr(),
            );

            let static_cls = to_wide("STATIC");
            let btn_cls = to_wide("BUTTON");
            let edit_cls = to_wide("EDIT");

            let title_text = to_wide(&format!(
                "Antigravity Codex & Claude 推理等级滑条 v{BUNDLED_VERSION}"
            ));
            let hwnd_title = CreateWindowExW(
                0,
                static_cls.as_ptr(),
                title_text.as_ptr(),
                WS_CHILD | WS_VISIBLE,
                20,
                16,
                560,
                24,
                hwnd,
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null(),
            );

            let status_init = to_wide(&format_status_summary());
            let hwnd_status = CreateWindowExW(
                0,
                static_cls.as_ptr(),
                status_init.as_ptr(),
                WS_CHILD | WS_VISIBLE,
                20,
                48,
                560,
                46,
                hwnd,
                ID_STATUS_LABEL as _,
                hinstance,
                std::ptr::null(),
            );

            let btn1_txt = to_wide("一键安装 / 修复");
            let hwnd_btn_install = CreateWindowExW(
                0,
                btn_cls.as_ptr(),
                btn1_txt.as_ptr(),
                WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON as u32,
                20,
                104,
                132,
                34,
                hwnd,
                ID_BTN_INSTALL as _,
                hinstance,
                std::ptr::null(),
            );

            let btn2_txt = to_wide("检查并更新");
            let hwnd_btn_update = CreateWindowExW(
                0,
                btn_cls.as_ptr(),
                btn2_txt.as_ptr(),
                WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON as u32,
                162,
                104,
                122,
                34,
                hwnd,
                ID_BTN_UPDATE as _,
                hinstance,
                std::ptr::null(),
            );

            let btn3_txt = to_wide("完全卸载还原");
            let hwnd_btn_uninstall = CreateWindowExW(
                0,
                btn_cls.as_ptr(),
                btn3_txt.as_ptr(),
                WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON as u32,
                294,
                104,
                122,
                34,
                hwnd,
                ID_BTN_UNINSTALL as _,
                hinstance,
                std::ptr::null(),
            );

            let btn4_txt = to_wide("刷新状态");
            let hwnd_btn_refresh = CreateWindowExW(
                0,
                btn_cls.as_ptr(),
                btn4_txt.as_ptr(),
                WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON as u32,
                426,
                104,
                100,
                34,
                hwnd,
                ID_BTN_REFRESH as _,
                hinstance,
                std::ptr::null(),
            );

            let log_init = to_wide(
                "准备就绪。安装后插件将托管至 ~/.gemini/config/plugins/，支持自动拉取 GitHub Release 更新，且在 Antigravity 更新后自动修复补丁。",
            );
            let hwnd_log = CreateWindowExW(
                0,
                edit_cls.as_ptr(),
                log_init.as_ptr(),
                WS_CHILD
                    | WS_VISIBLE
                    | WS_BORDER
                    | WS_VSCROLL
                    | ES_MULTILINE as u32
                    | ES_READONLY as u32
                    | ES_AUTOVSCROLL as u32,
                20,
                152,
                560,
                190,
                hwnd,
                ID_LOG_BOX as _,
                hinstance,
                std::ptr::null(),
            );

            for ctrl in [
                hwnd_title,
                hwnd_status,
                hwnd_btn_install,
                hwnd_btn_update,
                hwnd_btn_uninstall,
                hwnd_btn_refresh,
                hwnd_log,
            ] {
                SendMessageW(ctrl, WM_SETFONT, font as WPARAM, 1);
            }

            let store = UI_HANDLES.get_or_init(|| Mutex::new(None));
            if let Ok(mut guard) = store.lock() {
                *guard = Some(UiHandles {
                    hwnd_main: hwnd as isize,
                    hwnd_status: hwnd_status as isize,
                    hwnd_log: hwnd_log as isize,
                    hwnd_btn_install: hwnd_btn_install as isize,
                    hwnd_btn_update: hwnd_btn_update as isize,
                    hwnd_btn_uninstall: hwnd_btn_uninstall as isize,
                    hwnd_btn_refresh: hwnd_btn_refresh as isize,
                });
            }
            0
        }
        WM_COMMAND => {
            let id = wparam & 0xFFFF;
            match id {
                ID_BTN_INSTALL => {
                    run_bg_task("安装 / 修复", || {
                        let rep = patcher::install_all(None, None);
                        format_report(&rep)
                    });
                }
                ID_BTN_UPDATE => {
                    run_bg_task("检查 GitHub Release 更新", || {
                        let res = updater::check_and_apply_update(true, false);
                        format!("状态：{}\r\n说明：{}", res.status, res.message)
                    });
                }
                ID_BTN_UNINSTALL => {
                    run_bg_task("完全卸载与还原", || {
                        let rep = patcher::uninstall_all(None);
                        format_report(&rep)
                    });
                }
                ID_BTN_REFRESH => {
                    run_bg_task("刷新环境状态", || "已刷新当前本机环境状态。".to_string());
                }
                _ => {}
            }
            0
        }
        WM_APP_TASK_DONE => {
            if let Some(res_lock) = PENDING_RESULT.get() {
                if let Ok(mut res_guard) = res_lock.lock() {
                    if let Some((status_text, log_text)) = res_guard.take() {
                        if let Some(h_lock) = UI_HANDLES.get() {
                            if let Ok(h_guard) = h_lock.lock() {
                                if let Some(h) = h_guard.as_ref() {
                                    set_window_text(h.hwnd_status as HWND, &status_text);
                                    set_window_text(h.hwnd_log as HWND, &log_text);
                                }
                            }
                        }
                    }
                }
            }
            set_buttons_enabled(true);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// 启动 Windows 原生图形安装面板
pub fn run_gui() {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let hinstance = GetModuleHandleW(std::ptr::null());
        let class_name = to_wide("AgEffortSliderInstallerWnd");
        let wc = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfnWndProc: Some(wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: std::ptr::null_mut(),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            hbrBackground: GetStockObject(WHITE_BRUSH as i32) as _,
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
            hIconSm: std::ptr::null_mut(),
        };
        RegisterClassExW(&wc);

        let title = to_wide("Antigravity 推理等级滑条 · 安装管理");
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            616,
            396,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinstance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            return;
        }
        ShowWindow(hwnd, SW_SHOW);

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
