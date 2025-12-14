# Flockmod app with Tauri

This version uses [Tauri](https://tauri.app) to wrap Flockmod in a minimal native shell.
Tauri leverages the builtin Webview2 browser on Windows which allows for a very small executable size as well as great performance.
Version 1.2 and onward of this app also includes modified javascript injection from the /src-tauri/assets/ folder. 
## What's changed from default Flockmod

- This client will connect to a small, private deno server (wss://flocksockets.devorous.deno.net)
- This server is used to allow modded users to see which other users are modded.
- The source code for this server can be found here: https://github.com/devorous/flocksockets
  
- If the room board size is XL, it will automatically change the resolution to 2160x1920.
- There is some custom styling applied by default.
  
### This mod also includes a couple of tweaks based upon Zexium's mods:
- If you lose connection, you will attempt to reconnect immediately
- Troll detection w/ sound effect when a troll is detected, and making their name in the userlist stand out.


This is a test release - There will be added functionality for toggling the custom css and the custom sound effect.


If you wish to build it yourself, you'll need to ensure you have rust and Node.js installed locally.
You can use the commands 'npm run tauri dev' and 'npm run tauri build' for testing and building the installers respectively.
