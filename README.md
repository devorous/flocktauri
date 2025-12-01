# Flockmod app with Tauri

This version uses [Tauri](https://tauri.app) to wrap Flockmod in a minimal native shell.
Tauri leverages the builtin Webview2 browser on Windows which allows for a very small executable size as well as great performance.
Version 1.2 of this app also includes modified javascript injection from the /src-tauri/assets/ folder. 
The only modification in this version currently is increasing the board size to 1920x2160 when joining.

If you wish to build it yourself, you'll need to ensure you have rust and Node.js installed locally.
You can use the commands 'npm run tauri dev' and 'npm run tauri build' for testing and building the installers respectively.

