// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{ WebviewUrl, WebviewWindowBuilder}; // Removed unused Manager to clear warnings

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 1. Embed your script files into the binary at compile time
            // Using CARGO_MANIFEST_DIR ensures it always finds your 'assets' folder
            let flockmod_override_code = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/flockmod.js"));
            let injected_mod_code = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/injected.js"));
            let css_override_code = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/flockmod.css"));

            // 2. Build the combined script
            let full_init_script = format!(
                r#"
                (function() {{
                    const OVERRIDE_JS = {over_js:?};
                    const INJECTED_JS = {inj_js:?};
                    const OVERRIDE_CSS = {css:?};

                    const style = document.createElement('style');
                    style.textContent = OVERRIDE_CSS;
                    (document.head || document.documentElement).appendChild(style);

                    const observer = new MutationObserver((mutations) => {{
                        for (const mutation of mutations) {{
                            for (const node of mutation.addedNodes) {{
                                if (node.tagName === 'SCRIPT' && node.src && node.src.includes('flockmod.js')) {{
                                    node.parentNode.removeChild(node);
                                    
                                    const replacement = document.createElement('script');
                                    replacement.textContent = OVERRIDE_JS;
                                    document.head.appendChild(replacement);

                                    const mod = document.createElement('script');
                                    mod.textContent = INJECTED_JS;
                                    document.head.appendChild(mod);

                                    observer.disconnect();
                                }}
                            }}
                        }}
                    }});
                    observer.observe(document.documentElement, {{ childList: true, subtree: true }});
                }})();
                "#,
                over_js = flockmod_override_code,
                inj_js = injected_mod_code,
                css = css_override_code
            );

            // 3. Create the window manually to attach the initialization script
            let window = WebviewWindowBuilder::new(
                app,
                "flockmod-window",
                WebviewUrl::External("https://flockmod.com/draw/".parse().unwrap())
            )
            .title("Flockmod")
            .initialization_script(&full_init_script) 
            .inner_size(1280.0, 800.0)
            .build()?;
            #[cfg(debug_assertions)]
            {
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}