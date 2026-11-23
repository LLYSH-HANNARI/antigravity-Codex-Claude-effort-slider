//! 路径探测模块：定位插件根目录、Antigravity Desktop app.asar 与 Antigravity IDE 安装目录。
//! 所有路径均支持环境变量覆盖，便于单元测试与隔离验证。

use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// 插件在 ~/.gemini/config/plugins/ 下的固定目录名
pub const PLUGIN_DIR_NAME: &str = "antigravity-effort-slider";

/// 获取当前用户主目录（兼容 HOME 与 Windows USERPROFILE）
pub fn home_dir() -> PathBuf {
    if let Ok(home) = env::var("HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    if let Ok(profile) = env::var("USERPROFILE") {
        if !profile.trim().is_empty() {
            return PathBuf::from(profile);
        }
    }
    PathBuf::from(".")
}

/// 获取 Antigravity 全局配置目录 `~/.gemini/config`
pub fn gemini_config_dir() -> PathBuf {
    if let Ok(custom) = env::var("AG_SLIDER_GEMINI_CONFIG_DIR") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }
    home_dir().join(".gemini").join("config")
}

/// 获取插件托管根目录：默认 ~/.gemini/config/plugins/antigravity-effort-slider/
/// 若设置了 AG_SLIDER_PLUGIN_ROOT 环境变量则优先使用，用于隔离测试。
pub fn plugin_root() -> PathBuf {
    if let Ok(custom) = env::var("AG_SLIDER_PLUGIN_ROOT") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }
    gemini_config_dir()
        .join("plugins")
        .join(PLUGIN_DIR_NAME)
}

/// 若当前处于标准插件目录名 `antigravity-effort-slider` 下，返回同级旧实验目录 `codex-effort-slider` 以便自动清理；
/// 隔离测试中目录名非 `antigravity-effort-slider` 时返回 None，避免误触真实环境。
pub fn legacy_prototype_plugin_dir() -> Option<PathBuf> {
    let root = plugin_root();
    if root.file_name().and_then(|s| s.to_str()) != Some(PLUGIN_DIR_NAME) {
        return None;
    }
    root.parent().map(|p| p.join("codex-effort-slider"))
}

/// 插件二进制所在目录 `<plugin_root>/bin`
pub fn bin_dir() -> PathBuf {
    plugin_root().join("bin")
}

/// 当前平台安装后的可执行文件路径
pub fn installed_binary_name() -> &'static str {
    if cfg!(windows) {
        "ag-effort-slider.exe"
    } else {
        "ag-effort-slider"
    }
}

/// 当前平台安装后的二进制完整路径
pub fn installed_binary_path() -> PathBuf {
    bin_dir().join(installed_binary_name())
}

/// 动态加载的客户端脚本路径 `<plugin_root>/lib/client.js`
pub fn client_js_path() -> PathBuf {
    plugin_root().join("lib").join("client.js")
}

/// Sidecar 控制面板 HTML 路径 `<plugin_root>/lib/sidecar-panel.html`
pub fn sidecar_html_path() -> PathBuf {
    plugin_root().join("lib").join("sidecar-panel.html")
}

/// 插件图标路径 `<plugin_root>/assets/logo.svg`
pub fn logo_svg_path() -> PathBuf {
    plugin_root().join("assets").join("logo.svg")
}

/// Sidecar 清单路径 `<plugin_root>/sidecars/slider_panel/sidecar.json`
pub fn sidecar_json_path() -> PathBuf {
    plugin_root()
        .join("sidecars")
        .join("slider_panel")
        .join("sidecar.json")
}

/// 重启请求信号文件 `<plugin_root>/.relaunch-request`
pub fn relaunch_request_path() -> PathBuf {
    plugin_root().join(".relaunch-request")
}

/// 卸载通知信号文件 `<plugin_root>/.uninstall-request`
pub fn uninstall_request_path() -> PathBuf {
    plugin_root().join(".uninstall-request")
}

/// 插件运行时状态与配置路径 `<plugin_root>/state.json`
pub fn state_json_path() -> PathBuf {
    plugin_root().join("state.json")
}

/// Antigravity 原生插件清单 `<plugin_root>/plugin.json`
pub fn plugin_json_path() -> PathBuf {
    plugin_root().join("plugin.json")
}

/// Antigravity 生命周期钩子配置 `<plugin_root>/hooks.json`
pub fn hooks_json_path() -> PathBuf {
    plugin_root().join("hooks.json")
}

/// 探测 Antigravity Desktop 的 app.asar 路径列表。
/// 优先使用显式传入路径，其次环境变量 ANTIGRAVITY_ASAR_PATH，最后扫描系统默认安装路径。
pub fn find_desktop_asar_paths(custom: Option<&Path>) -> Vec<PathBuf> {
    if let Some(p) = custom {
        return vec![p.to_path_buf()];
    }
    if let Ok(env_path) = env::var("ANTIGRAVITY_ASAR_PATH") {
        if !env_path.trim().is_empty() {
            return vec![PathBuf::from(env_path)];
        }
    }

    let mut candidates = Vec::new();
    #[cfg(target_os = "windows")]
    {
        let local_app_data = env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home_dir().join("AppData").join("Local"));
        candidates.push(local_app_data.join("Programs").join("antigravity").join("resources").join("app.asar"));
        candidates.push(local_app_data.join("antigravity").join("resources").join("app.asar"));
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/Applications/Antigravity.app/Contents/Resources/app.asar"));
        candidates.push(
            home_dir()
                .join("Applications")
                .join("Antigravity.app")
                .join("Contents")
                .join("Resources")
                .join("app.asar"),
        );
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        candidates.push(PathBuf::from("/opt/Antigravity/resources/app.asar"));
        candidates.push(PathBuf::from("/usr/lib/antigravity/resources/app.asar"));
        candidates.push(home_dir().join(".local").join("share").join("antigravity").join("resources").join("app.asar"));
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for p in candidates {
        if p.exists() {
            let key = canonical_key(&p);
            if seen.insert(key) {
                out.push(p);
            }
        }
    }
    out
}

/// 探测 Antigravity IDE 的 `resources/app` 根目录列表（去重）
pub fn find_ide_roots() -> Vec<PathBuf> {
    if let Ok(custom_ide) = env::var("ANTIGRAVITY_IDE_PATH") {
        if !custom_ide.trim().is_empty() {
            let app_dir = PathBuf::from(custom_ide).join("resources").join("app");
            if app_dir.exists() && app_dir.join("product.json").exists() {
                return vec![app_dir];
            }
            return Vec::new();
        }
    }

    let mut candidate_roots: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let local_app_data = env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home_dir().join("AppData").join("Local"));
        let program_files = env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let program_files_x86 =
            env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());

        candidate_roots.push(PathBuf::from("D:\\Antigravity IDE"));
        candidate_roots.push(local_app_data.join("Programs").join("antigravity IDE"));
        candidate_roots.push(local_app_data.join("Programs").join("Antigravity IDE"));
        candidate_roots.push(PathBuf::from(program_files).join("Antigravity IDE"));
        candidate_roots.push(PathBuf::from(program_files_x86).join("Antigravity IDE"));
    }
    #[cfg(target_os = "macos")]
    {
        candidate_roots.push(PathBuf::from("/Applications/Antigravity IDE.app/Contents"));
        candidate_roots.push(
            home_dir()
                .join("Applications")
                .join("Antigravity IDE.app")
                .join("Contents"),
        );
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        candidate_roots.push(PathBuf::from("/opt/antigravity-ide"));
        candidate_roots.push(PathBuf::from("/usr/lib/antigravity-ide"));
    }

    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    for root in candidate_roots {
        let app_dir = root.join("resources").join("app");
        if app_dir.exists() && app_dir.join("product.json").exists() {
            let key = canonical_key(&app_dir);
            if seen.insert(key) {
                roots.push(app_dir);
            }
        }
    }
    roots
}

/// 定位 Antigravity IDE 的核心扩展入口文件 (`extensions/agy/vscode/extension.js` 或 `dist/extension.js`)
pub fn find_ide_extension_files() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for app_dir in find_ide_roots() {
        let ext_vscode = app_dir
            .join("extensions")
            .join("agy")
            .join("vscode")
            .join("extension.js");
        let ext_dist = app_dir
            .join("extensions")
            .join("agy")
            .join("dist")
            .join("extension.js");
        if ext_vscode.exists() {
            out.push(ext_vscode);
        } else if ext_dist.exists() {
            out.push(ext_dist);
        }
    }
    out
}

/// 定位旧版曾修补过的 IDE 遗留文件 (`workbench.js` / `jetskiAgent/main.js`)，用于平滑迁移清理
pub fn find_ide_legacy_files() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for app_dir in find_ide_roots() {
        let workbench = app_dir
            .join("out")
            .join("vs")
            .join("code")
            .join("electron-browser")
            .join("workbench")
            .join("workbench.js");
        let jetski_main = app_dir.join("out").join("jetskiAgent").join("main.js");
        if workbench.exists() {
            out.push(workbench);
        }
        if jetski_main.exists() {
            out.push(jetski_main);
        }
    }
    out
}

/// 获取 Antigravity IDE 的 V8 代码缓存目录（CachedData）
pub fn ide_cached_data_dir() -> Option<PathBuf> {
    if let Ok(custom) = env::var("AG_SLIDER_IDE_CACHED_DATA") {
        if !custom.trim().is_empty() {
            return Some(PathBuf::from(custom));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = env::var("APPDATA") {
            return Some(PathBuf::from(app_data).join("Antigravity IDE").join("CachedData"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        return Some(
            home_dir()
                .join("Library")
                .join("Application Support")
                .join("Antigravity IDE")
                .join("CachedData"),
        );
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return Some(
            home_dir()
                .join(".config")
                .join("Antigravity IDE")
                .join("CachedData"),
        );
    }
    #[allow(unreachable_code)]
    None
}

fn canonical_key(p: &Path) -> String {
    let resolved = fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let s = resolved.to_string_lossy().to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}
