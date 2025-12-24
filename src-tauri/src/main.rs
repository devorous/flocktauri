// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let flockmod_override_code = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/flockmod.js"));
            let injected_mod_code = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/injected.js"));
            let css_override_code = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/flockmod.css"));

            //Build the combined script with safety checks
            let full_init_script = format!(
                r#"
                (function() {{
                    const OVERRIDE_JS = {over_js:?};
                    const INJECTED_JS = {inj_js:?};
                    const OVERRIDE_CSS = {css:?};

                    function startInterception() {{
                        // Inject CSS immediately if possible
                        const style = document.createElement('style');
                        style.textContent = OVERRIDE_CSS;
                        (document.head || document.documentElement).appendChild(style);

                        const observer = new MutationObserver((mutations) => {{
                            for (const mutation of mutations) {{
                                for (const node of mutation.addedNodes) {{
                                    if (node.tagName === 'SCRIPT' && node.src && node.src.includes('flockmod.js')) {{
                                        // Block the original
                                        if (node.parentNode) {{
                                            node.parentNode.removeChild(node);
                                        }}
                                        
                                        // Inject replacement
                                        const replacement = document.createElement('script');
                                        replacement.textContent = OVERRIDE_JS;
                                        document.head.appendChild(replacement);

                                        // Inject mod logic
                                        const mod = document.createElement('script');
                                        mod.textContent = INJECTED_JS;
                                        document.head.appendChild(mod);

                                        observer.disconnect();
                                        console.log('[Mod] Interception successful');
                                        return;
                                    }}
                                }}
                            }}
                        }});

                        observer.observe(document, {{ childList: true, subtree: true }});
                    }}

                    // Wait for the document to load
                    if (document.documentElement || document.body) {{
                        startInterception();
                    }} else {{
                        // Extreme fallback for very early execution
                        const initObserver = new MutationObserver(() => {{
                            if (document.documentElement) {{
                                initObserver.disconnect();
                                startInterception();
                            }}
                        }});
                        initObserver.observe(document, {{ childList: true, subtree: true }});
                    }}
                }})();
                "#,
                over_js = flockmod_override_code,
                inj_js = injected_mod_code,
                css = css_override_code
            );

            // 3. Create the window
            WebviewWindowBuilder::new(
                app,
                "flockmod-window",
                WebviewUrl::External("https://flockmod.com/draw/".parse().unwrap())
            )
            .title("Flockmod")
            .initialization_script(&full_init_script) 
            .inner_size(1280.0, 800.0)
            .build()?;


            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}