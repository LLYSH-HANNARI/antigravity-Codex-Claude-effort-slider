//! 最佳努力系统原生通知模块：用于在 Hook 后台自动修复补丁或 CLI 完成后提醒用户重启 Antigravity。

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 弹出操作系统原生桌面通知（静默失败，不阻塞主流程）
pub fn send_system_notification(title: &str, body: &str) {
    #[cfg(target_os = "windows")]
    {
        send_windows_toast(title, body);
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display notification {} with title {}",
            escape_applescript(body),
            escape_applescript(title)
        );
        let _ = Command::new("osascript").arg("-e").arg(script).status();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = Command::new("notify-send").arg(title).arg(body).status();
    }
}

#[cfg(target_os = "windows")]
fn send_windows_toast(title: &str, body: &str) {
    // 通过 PowerShell 调用 WinRT ToastNotificationManager，无需额外 COM 依赖，且使用 CREATE_NO_WINDOW 不闪黑框
    let esc_title = xml_escape(title);
    let esc_body = xml_escape(body);
    let ps_script = format!(
        r#"$ErrorActionPreference='SilentlyContinue';
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument;
$xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">{esc_title}</text><text id="2">{esc_body}</text></binding></visual></toast>');
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml);
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Antigravity Codex Effort Slider').Show($toast);"#
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps_script])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[cfg(target_os = "windows")]
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "macos")]
fn escape_applescript(s: &str) -> String {
    let clean = s.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{clean}\"")
}
