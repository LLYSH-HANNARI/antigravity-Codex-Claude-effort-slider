//! macOS / Linux 交互式终端菜单（无参数直接运行时展示）。

#[cfg(not(windows))]
use std::io::{self, Write};

#[cfg(not(windows))]
use crate::patcher;
#[cfg(not(windows))]
use crate::state::BUNDLED_VERSION;
#[cfg(not(windows))]
use crate::updater;

#[cfg(not(windows))]
pub fn run_menu() {
    println!("======================================================");
    println!("  Antigravity 推理等级滑条 · 安装管理 (v{BUNDLED_VERSION})");
    println!("======================================================");

    loop {
        let st = patcher::inspect_status(None);
        println!(
            "\n当前插件状态: {}",
            if st.plugin_installed {
                format!("已安装 (v{})", st.installed_version.as_deref().unwrap_or(BUNDLED_VERSION))
            } else {
                "未安装".to_string()
            }
        );
        println!("  1) 一键安装 / 修复引导器（保留其他插件）");
        println!("  2) 检查并应用 GitHub Release 更新");
        println!("  3) 卸载本插件（保留其他插件）");
        println!("  4) 退出");
        print!("请选择 [1-4]: ");
        let _ = io::stdout().flush();

        let mut input = String::new();
        if io::stdin().read_line(&mut input).is_err() {
            break;
        }
        match input.trim() {
            "1" => {
                let rep = patcher::install_all(None, None);
                for m in &rep.messages {
                    println!("  • {m}");
                }
                for e in &rep.errors {
                    eprintln!("  ! {e}");
                }
            }
            "2" => {
                let res = updater::check_and_apply_update(true, false);
                println!("  [{}] {}", res.status, res.message);
            }
            "3" => {
                let rep = patcher::uninstall_all(None);
                for m in &rep.messages {
                    println!("  • {m}");
                }
                for e in &rep.errors {
                    eprintln!("  ! {e}");
                }
            }
            "4" | "q" | "Q" => break,
            _ => println!("无效选项，请输入 1-4。"),
        }
    }
}
