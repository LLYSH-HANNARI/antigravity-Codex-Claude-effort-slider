//! Antigravity `SessionStart` 生命周期钩子处理模块。
//!
//! 关键约束：
//! - Antigravity 同步阻塞等待钩子返回 stdout JSON，因此本模块必须在 <10ms 内完成：
//!   1. 快速 seek 检查 app.asar / IDE extension.js 是否被官方更新覆盖；
//!   2. 若丢失补丁，脱离终端后台拉起 `repair --from-hook`，并向用户输出一次性 `user_markdown` 提示卡片（不入模型上下文）；
//!   3. 若补丁完好且冷却时间已到，脱离终端后台拉起 `update --background`，立即输出 `{}`。

use std::io::Read;

use crate::notify;
use crate::patcher;
use crate::state;

/// 执行 `SessionStart` 钩子并返回标准 JSON 字符串
pub fn handle_session_start() -> String {
    patcher::cleanup_old_binary();

    // 快速消耗 stdin（设 256KB 上限），避免上游管道阻塞；单元测试跳过真实进程 stdin 读取
    if !cfg!(test) {
        let mut stdin_buf = Vec::new();
        let _ = std::io::stdin().take(256 * 1024).read_to_end(&mut stdin_buf);
    }

    if let Some(fingerprint) = patcher::detect_missing_loaders(None) {
        // 官方更新冲掉了引导器：后台异步自动修复
        let _ = patcher::spawn_detached_self(&["repair", "--from-hook"]);

        let mut st = state::load_state();
        if st.last_repaired_fingerprint.as_deref() != Some(fingerprint.as_str()) {
            st.last_repaired_fingerprint = Some(fingerprint);
            let _ = state::save_state(&st);

            let msg = concat!(
                "> **推理等级滑条提示**：检测到 Antigravity 已更新，系统已自动在后台为您重新注入滑条补丁。",
                "本次对话完成后，请关闭并重启 Antigravity 即可恢复显示。"
            );
            let payload = serde_json::json!({
                "injectSteps": [
                    {
                        "systemMessage": {
                            "systemMessage": "",
                            "metadata": {
                                "user_markdown": msg
                            }
                        }
                    }
                ]
            });
            return payload.to_string();
        }
        return "{}".to_string();
    }

    // 补丁完好：按冷却时间在后台静默检查 Release 更新
    let st = state::load_state();
    let now = state::now_unix_secs();
    let cooldown_secs = st.check_interval_hours.max(1) * 3600;
    if st.auto_update && (st.last_check_at == 0 || now.saturating_sub(st.last_check_at) >= cooldown_secs) {
        let _ = patcher::spawn_detached_self(&["update", "--background"]);
    }

    "{}".to_string()
}

/// 后台异步执行的修复流程（由 `SessionStart` 钩子拉起）
pub fn run_repair_from_hook() {
    let report = patcher::repair_loaders_only(None);
    if report.ok {
        notify::send_system_notification(
            "推理等级滑条补丁已自动修复",
            "检测到 Antigravity 更新，滑条补丁已重新就绪，重启客户端即可生效。",
        );
    }
}
