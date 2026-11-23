#![cfg_attr(all(windows, not(test)), windows_subsystem = "windows")]

//! Antigravity Codex & Claude 推理等级滑条 · 原生安装与自更新引擎入口
//!
//! 双模式设计：
//! - 无命令行参数：Windows 启动极简原生 Win32 GUI 面板；macOS/Linux 启动交互式菜单；
//! - 带子命令参数：静默 CLI 模式，供 `hooks.json`、Electron 主进程、IDE 扩展与在线安装脚本调用。

mod asar;
mod cli_interactive;
#[cfg(windows)]
mod gui_win;
mod hook;
mod loader;
mod notify;
mod patcher;
mod paths;
mod state;
#[cfg(test)]
mod tests;
mod updater;

use std::env;
use std::path::PathBuf;
use std::process;

/// 在 Windows `windows_subsystem = "windows"` 下，仅当 CLI 模式且 stdout 未被管道/文件重定向时，
/// 尝试附加到父进程控制台，既保证终端可读输出，又绝对不破坏管道 JSON（如 hooks.json / main.js）。
#[cfg(windows)]
fn attach_parent_console_if_needed() {
    use windows_sys::Win32::Storage::FileSystem::{GetFileType, FILE_TYPE_UNKNOWN};
    use windows_sys::Win32::System::Console::{
        AttachConsole, GetStdHandle, ATTACH_PARENT_PROCESS, STD_OUTPUT_HANDLE,
    };

    unsafe {
        let h_out = GetStdHandle(STD_OUTPUT_HANDLE);
        let file_type = if h_out.is_null() {
            FILE_TYPE_UNKNOWN
        } else {
            GetFileType(h_out)
        };
        if file_type == FILE_TYPE_UNKNOWN {
            let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    if args.is_empty() {
        #[cfg(windows)]
        {
            gui_win::run_gui();
        }
        #[cfg(not(windows))]
        {
            cli_interactive::run_menu();
        }
        return;
    }

    #[cfg(windows)]
    {
        // `hook` 与 `--background` 全程管道/静默运行，无需附加控制台；其余终端 CLI 子命令按需附加
        let cmd = args.first().map(|s| s.as_str()).unwrap_or("");
        let is_silent = cmd == "hook"
            || cmd == "deferred-swap"
            || cmd == "deferred-op"
            || args.iter().any(|a| a == "--background");
        if !is_silent {
            attach_parent_console_if_needed();
        }
    }

    let exit_code = run_cli(&args);
    if exit_code != 0 {
        process::exit(exit_code);
    }
}

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.windows(2)
        .find(|w| w[0] == flag)
        .map(|w| w[1].clone())
}

fn has_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

fn run_cli(args: &[String]) -> i32 {
    let cmd = args[0].as_str();
    let json_mode = has_flag(args, "--json");

    match cmd {
        "install" => {
            let asar = arg_value(args, "--asar").map(PathBuf::from);
            let client = arg_value(args, "--client").map(PathBuf::from);
            let rep = patcher::install_all(asar.as_deref(), client.as_deref());
            if json_mode {
                println!("{}", serde_json::to_string(&rep).unwrap_or_default());
            } else {
                for m in &rep.messages {
                    println!("{m}");
                }
                for e in &rep.errors {
                    eprintln!("错误: {e}");
                }
            }
            if rep.ok { 0 } else { 1 }
        }
        "uninstall" => {
            let asar = arg_value(args, "--asar").map(PathBuf::from);
            let rep = patcher::uninstall_all(asar.as_deref());
            if json_mode {
                println!("{}", serde_json::to_string(&rep).unwrap_or_default());
            } else {
                for m in &rep.messages {
                    println!("{m}");
                }
                for e in &rep.errors {
                    eprintln!("错误: {e}");
                }
            }
            if rep.ok { 0 } else { 1 }
        }
        "repair" => {
            if has_flag(args, "--from-hook") {
                hook::run_repair_from_hook();
                return 0;
            }
            let asar = arg_value(args, "--asar").map(PathBuf::from);
            let rep = patcher::repair_loaders_only(asar.as_deref());
            if json_mode {
                println!("{}", serde_json::to_string(&rep).unwrap_or_default());
            } else {
                for m in &rep.messages {
                    println!("{m}");
                }
                for e in &rep.errors {
                    eprintln!("错误: {e}");
                }
            }
            if rep.ok { 0 } else { 1 }
        }
        "status" => {
            let asar = arg_value(args, "--asar").map(PathBuf::from);
            let st = patcher::inspect_status(asar.as_deref());
            if json_mode {
                println!("{}", serde_json::to_string_pretty(&st).unwrap_or_default());
            } else {
                println!("插件目录: {}", st.plugin_root);
                println!(
                    "插件状态: {}",
                    if st.plugin_installed {
                        format!("已安装 v{}", st.installed_version.as_deref().unwrap_or("?"))
                    } else {
                        "未安装".to_string()
                    }
                );
                println!("自动更新: {} | 镜像前缀: {}", st.auto_update, if st.mirror_prefix.is_empty() { "(无)" } else { &st.mirror_prefix });
                for d in &st.desktop_targets {
                    println!(
                        "Desktop: {} | patched={} | loader={:?} | staged={}",
                        d.path, d.patched, d.loader_version, d.has_staged
                    );
                }
                for ide in &st.ide_targets {
                    println!(
                        "IDE:     {} | patched={} | loader={:?}",
                        ide.path, ide.patched, ide.loader_version
                    );
                }
            }
            0
        }
        "update" => {
            let force = has_flag(args, "--force");
            let background = has_flag(args, "--background");
            let res = updater::check_and_apply_update(force, background);
            if json_mode {
                println!("{}", serde_json::to_string(&res).unwrap_or_default());
            } else {
                println!("[{}] {}", res.status, res.message);
            }
            if res.ok { 0 } else { 1 }
        }
        "config" => {
            let mut st = state::load_state();
            if let Some(val) = arg_value(args, "--auto-update") {
                st.auto_update = matches!(val.to_ascii_lowercase().as_str(), "true" | "1" | "yes");
            }
            if let Some(mirror) = arg_value(args, "--mirror") {
                st.mirror_prefix = mirror.trim().to_string();
            }
            if let Err(e) = state::save_state(&st) {
                if json_mode {
                    println!("{}", serde_json::json!({ "ok": false, "error": e }));
                } else {
                    eprintln!("保存配置失败: {e}");
                }
                return 1;
            }
            if json_mode {
                println!("{}", serde_json::to_string(&st).unwrap_or_default());
            } else {
                println!("已保存配置: autoUpdate={}, mirrorPrefix={}", st.auto_update, st.mirror_prefix);
            }
            0
        }
        "hook" => {
            let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
            if sub == "session-start" {
                let out = hook::handle_session_start();
                println!("{out}");
                0
            } else {
                println!("{{}}");
                0
            }
        }
        "deferred-op" => {
            let action = arg_value(args, "--action").unwrap_or_else(|| "install".to_string());
            let Some(target) = arg_value(args, "--target").map(PathBuf::from) else {
                return 1;
            };
            let relaunch = arg_value(args, "--relaunch").map(PathBuf::from);
            if patcher::run_deferred_op(&action, &target, relaunch.as_deref()) {
                0
            } else {
                1
            }
        }
        "deferred-swap" => {
            let Some(staged) = arg_value(args, "--staged").map(PathBuf::from) else {
                return 1;
            };
            let Some(target) = arg_value(args, "--target").map(PathBuf::from) else {
                return 1;
            };
            let relaunch = arg_value(args, "--relaunch").map(PathBuf::from);
            if patcher::run_deferred_swap(&staged, &target, relaunch.as_deref()) {
                0
            } else {
                1
            }
        }
        "version" | "--version" | "-v" => {
            println!("ag-effort-slider {}", state::BUNDLED_VERSION);
            0
        }
        _ => {
            eprintln!("用法: ag-effort-slider <install|uninstall|repair|status|update|config|hook|version> [选项]");
            1
        }
    }
}
