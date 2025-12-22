let drawbot;
let drawgame;
let copier;
let modsocket;
let messagehandler;
let broadcasthandler;
let actionhandler;
let modsDialogInject;



console.log("Mods loaded...");

const STORAGE_KEY = 'mod_settings';

const DEFAULT_SETTINGS = {
    customCssEnabled: true,
    customCss: ""
};

function loadSettings() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            // Merge stored settings with defaults (handles future added fields)
            return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
        }
    } catch (e) {
        console.error("Error loading FlockMod settings:", e);
    }
    return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        console.log("Settings saved to localStorage");
    } catch (e) {
        console.error("Error saving FlockMod settings:", e);
    }
}

class ModSocket{
    constructor(){
        this.userId = null;
        this.users = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.connect();
    }
    
    connect(){
        // Optional: Remove this check if you want infinite reconnects
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error("Max reconnection attempts reached");
            return;
        }
        
        // Clean up old socket if it exists
        if (this.socket) {
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onmessage = null;
            this.socket.onopen = null;
        }
        
        this.socket = new WebSocket("wss://flocksockets.devorous.deno.net");
        
        this.socket.onopen = () => {
            console.log("D socket connected");
            this.reconnectAttempts = 0; // Reset on successful connection
        }
        
        this.socket.onmessage = (event) => {
            try {
                this.receive(JSON.parse(event.data));
            } catch (e) {
                console.error("Failed to parse message:", e);
            }
        }
        
        this.socket.onerror = (error) => {
            console.log("D socket error:", error);
        }
        
        this.socket.onclose = (event) => {
            console.log("D socket closed:", event.code, event.reason);
            this.reconnectAttempts++;
            
            // Exponential backoff with max delay of 30 seconds
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            setTimeout(() => {
                console.log(`Reconnect attempt ${this.reconnectAttempts}...`);
                this.connect();
            }, delay);
        }
    }
    
    receive(data) {
        switch(data.type) {
            case 'init':
                this.userId = data.id;
                break;

            case 'PING':
                this.send({ type: 'PONG' });
                break;

            // A new user joined
            case 'userJoined':
                this.users.set(data.user.id, data.user);
                mod.modUsers = this.users;
                mod.updateUsers();
                break;

            // A user left
            case 'userLeft':
                this.users.delete(data.id);
                mod.modUsers = this.users;
                mod.updateUsers();
                break;

            // Full user snapshot (initial sync or resync)
            case 'userList':
                this.users.clear();
                for (const user of data.users) {
                    this.users.set(user.id, user);
                }
                mod.modUsers = this.users;
                mod.updateUsers();
                break;
        }
    }


    
    send(data){
        if(this.socket.readyState === WebSocket.OPEN){
            this.socket.send(JSON.stringify(data));
        } else {
            console.log("Cannot send - socket not open");
        }
    }
}
 
const startButton = document.getElementById("startButton");
if (startButton) {
    setTimeout(()=>{
        startButton.click(); 
    },500)
    
}


const splashScreenText = document.getElementsByClassName('splashScreenText')[0];


if(splashScreenText){
    splashScreenText.innerHTML = 'FLOCKMO<span>D</span>'
}

class ModHandler{
    constructor(){
        this.room = null;
        this.currentUsers = [];
        this.modUsers = [];
        this.connected = false;
        this.currentRoomName = null;
    }
    initialize() {
        this.room = window.room;
        this.currentUsers = window.room.users;
        this.height = this.room.board.canvasHeight;
        this.width = this.room.board.canvasWidth;

        // Only reset "firstSyncDone" if the room name has actually changed
        if (this.currentRoomName !== this.room.name) {
            console.log(`[Mod] New room detected (${this.room.name}). Resetting sync flags.`);
            this.firstSyncDone = false;
            this.currentRoomName = this.room.name;
        } else {
            console.log(`[Mod] Reconnected to same room (${this.room.name}). Preserving sync state.`);
        }
        // Reset the resync trigger (because we just connected, we start fresh timer-wise)
        this.shouldResync = false;
        this.startConnectionMonitor();
    }
    updateUsers(){
        for(let [id,m] of this.modUsers){
            let u = Object.values(this.currentUsers).find(u =>
                (u.username === m.name && this.room.name === m.room)
            )
            if(u){
                this.modifyUser(u);
                
            }

        }
    }
    modifyUser(user){
        user.modded = true;
        window.UI.sidebar.userList.updateUser(user) //Uses the modified updateUser function from this.setupRoomOverrides

    }
    handleRoomConnected() {
        console.log("Room connected");
        this.initialize();

        if(this.room.size === 'XL'){
            this.room.board.changeSize(1920, 2160);
        }

        if (!drawbot) {
            drawbot = new Drawbot();
        }

  
        if (!drawgame) {
            drawgame = new Drawgame(0, 1920, 0, 1080);
        }


        if (!copier) {
            copier = new Copier(messagehandler);
        }

        

        this.setupRoomOverrides();

        modsocket.send({'type': 'JOIN', 'id': modsocket.userId, 'name': this.room.myself.username, 'room': this.room.name});


        //Slight delay for some things to load
        setTimeout(()=>{
            this.updateUsers();
        },50);
    }
    handleRoomDisconnected() {
        console.log("Leaving room");
    }
    setupInterception() {
        
        if (window.room) {

            this.connected = true;

            console.log("Console loaded");

            window.modSettings = loadSettings(); 
            
            // If CSS is enabled in storage, inject it right now
            if (window.modSettings.customCssEnabled && window.modSettings.customCss) {
                
                let styleTag = $("<style id='flockmod-custom-css'>").appendTo("head");
                styleTag.text(window.modSettings.customCss);
            }
            // --------------------------------------------------
            this.startReconnectWatcher();

            messagehandler = new MessageHandler();
            broadcasthandler = new BroadcastHandler();
            messagehandler.register('BROADCAST', broadcasthandler.handle, broadcasthandler);

            window.socket.ws.onmessage = function(message) {
                messagehandler.handle(message);
                window.socket.receive(message);
            }


            const cssContent = customCss;

            // Create a data URI
            const dataUri = 'data:text/css;charset=utf-8,' + encodeURIComponent(cssContent);
            
            // Update the link tag
            $("head link[name='currentTheme']").attr("href", dataUri);

            modsocket = new ModSocket();

            this.setupGlobalOverrides();
        } else {
            setTimeout(() => {this.setupInterception()}, 100);
        }
    }

startReconnectWatcher() {
        let reconnecting = false;
        let lastReconnectTime = 0;
        
        // Tag the WebSocket instance to prevent double-hooking the onmessage handler
        const HOOK_TAG = 'isModHooked'; 

        setInterval(() => {
            const currentRoom = window.room;
            const currentSocket = window.socket;

            if (!currentRoom || !currentSocket) return;

            const ws = currentSocket.ws;
            
            // Success Condition & Hook Re-attachment 
            if (ws && ws.readyState === WebSocket.OPEN) {
                
                if (!ws[HOOK_TAG]) {
                    ws.onmessage = function (message) {
                        messagehandler.handle(message);
                        window.socket.receive(message);
                    };
                    ws[HOOK_TAG] = true; 
                }

                reconnecting = false;
                return;
            }

            // Wait for transitions (CONNECTING or CLOSING)
            if (ws && (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CONNECTING)) {
                return;
            }

            // Room Validations 
            if (!currentRoom.name || currentRoom.name === "lobby" || currentRoom.loading === true) {
                return;
            }

            if (currentRoom.users && Object.keys(currentRoom.users).length === 0) {
                return;
            }

            // Attempt Reconnect 
            const now = Date.now();
            const cooldown = 10000; 
            const timeDiff = now - lastReconnectTime;

            if (!reconnecting && typeof currentSocket.connect === "function") {
                
                if (timeDiff >= cooldown || lastReconnectTime === 0) {
                    
                    reconnecting = true;
                    lastReconnectTime = now;

                    try {
                        currentSocket.connect();
                    } catch (err) {
                        console.error("[Mod Watcher] socket.connect() threw an error:", err);
                    }
                }
            }
        }, 100); 
    }

    setupGlobalOverrides() {

        setupUI();

        const originalShowDialog = window.UI.dialogHandler.showDialog;
        window.UI.dialogHandler.showDialog = function(dialogName, params) {
            
            if (dialogName === "modD" && !this.dialogs["modD"]) {
                console.log("[Mod] Dialog doesn't exist, creating...");
                this.createDialog("modD");
            }
            
            return originalShowDialog.call(this, dialogName, params);
        };

        const waitForDialogHandler = () => {
            if (typeof window.UI === "undefined" || 
                typeof window.UI.dialogHandler === "undefined" || 
                typeof window.UI.dialogHandler.createDialog === "undefined" ||
                typeof Dialog === "undefined") {  // ADD THIS CHECK
                setTimeout(waitForDialogHandler, 100);
                return;
            }
            
            // Create the class NOW, when we know Dialog exists
            const ModsDialogInject = createModsDialogInjectClass();
            if (!ModsDialogInject) {
                console.error("Failed to create ModsDialogInject class");
                return;
            }

            const originalCreateDialog = window.UI.dialogHandler.createDialog;

            window.UI.dialogHandler.createDialog = function(dialogName) {
                if (dialogName === "modD") {
                    const modsDialogInject = new ModsDialogInject(this.container);
                    this.dialogs[dialogName] = modsDialogInject;
                    modsDialogInject.form.attr("name", dialogName);

                    const handler = this;

                    $(modsDialogInject).on("dialogOpened", function() {
                        modsDialogInject.formHolder.css("z-index", ++handler.zindex);
                        handler.openedDialogs++;
                        if (this.blockBackground) {
                            handler.blockBackground(this.blockStyle, this.blockOpacity);
                        }
                        handler.activateDialog(this);
                        $(handler).triggerHandler(new dialogOpenedEvent(modsDialogInject.name).getEvent());
                    });

                    $(modsDialogInject).on("dialogClosed", function() {
                        handler.zindex--;
                        handler.openedDialogs--;
                        handler.deactivateDialogs();
                        if (handler.openedDialogs <= 0 && this.blockBackground) {
                            handler.unblockBackground();
                        } else {
                            handler.activateDialog(handler.getNextVisibleDialog());
                        }
                        $(handler).triggerHandler(new dialogClosedEvent(modsDialogInject.name).getEvent());
                    });

                    return modsDialogInject;
                }

                return originalCreateDialog.call(this, dialogName);
            };
        };

        waitForDialogHandler();



        this.originalRecommendedSync = window.UI.recommendedSync;

        window.UI.recommendedSync = function (syncList) {
            // Preserve async timing from original override
            setTimeout(() => {
                mod.handleRecommendedSync(this, syncList);
            }, 100);
        };

        const originalSetConnected = window.room.setConnected;
        window.room.setConnected = function(isConnected) {
            if (isConnected) {
                mod.handleRoomConnected();
            } else {
                mod.handleRoomDisconnected();
            }
            originalSetConnected.call(window.room, isConnected);
        };
    }

    setupRoomOverrides(){

        

        const originalUpdateUser = window.UI.sidebar.userList.updateUser;

        // Override updateUser to give modded users a little crown in the user list
        window.UI.sidebar.userList.updateUser = function(user) {

            // Call original to build the row normally
            originalUpdateUser.call(this, user);

            // Find the user's row and the icon cell
            const $userRow = this.container.find(`tr[name="${user.username}"]`);
            const $iconCell = $userRow.find("td.text-center");

            if ($iconCell.length === 0) return;

            // Add or remove crown based on user.modded
            if (user.modded === true) {
                // Only append if it's not already there
                if ($iconCell.find(".mod-crown").length === 0) {
                    $iconCell.append('<div class="mod-crown userlistIcon">👑</div>');
                }
            }
            if(user.troll === true){
                $userRow.addClass('troll');
            }
        };
    }
    handleRecommendedSync(ui, syncList) {
        // Guard
        if (!Array.isArray(syncList) || syncList.length === 0) {
            return;
        }

        syncList.sort((a, b) => {
            const userA = this.room?.users?.[a];
            const userB = this.room?.users?.[b];

            const modA = userA?.modded === true;
            const modB = userB?.modded === true;

            if (modA && !modB) return -1;
            if (!modA && modB) return 1;
            return 0;
        });

        ui.firstSyncOrder = syncList;

        if (!this.firstSyncDone) {
            this.firstSyncDone = true;
            ui.trySync();
            return;
        }

        // ---- Subsequent syncs gated ----
        if (this.shouldResync === true) {
            ui.trySync();
        }
    }

    startConnectionMonitor() {
        if (this._connectionMonitor) return; // prevent duplicates

        this._connectionMonitor = setInterval(() => {
            // Not in a room → reset state
            if (!this.room?.name || this.room.name === "lobby") {
                this.lastDisconnectedTime = null;   
                this.shouldResync = false;
                return;
            }

            if (!this.room.connected) {
                if (this.lastDisconnectedTime === null) {
                    this.lastDisconnectedTime = Date.now();
                }

                // 20s disconnect threshold (matches original)
                if (Date.now() - this.lastDisconnectedTime > 20000) {
                    this.shouldResync = true;
                }
            } else {
                // Reconnected
                if (
                    this.lastDisconnectedTime !== null &&
                    Date.now() - this.lastDisconnectedTime <= 20000
                ) {
                    this.shouldResync = false;
                }

                this.lastDisconnectedTime = null;
            }
        }, 50);
    }
}

let mod = new ModHandler();


mod.setupInterception();



// Only create the class when Dialog is available
function createModsDialogInjectClass() {
    if (typeof Dialog === 'undefined') {
        console.error("Dialog class not available yet");
        return null;
    }

    return class ModsDialogInject extends Dialog {
        constructor(container) {
            super(container);

            this.icon = "fa-crown";
            this.caption = "Mod Settings";
            this.width = 700;
            this.height = 600;

            this.loadContent(`
              <div class="dialog-content" style="display: flex; height: 100%;">
                
                <div class="sidebar" style="
                  width: 150px;
                  background-color: var(--bs-tertiary-bg);
                  padding: 10px;
                  border-right: 1px solid var(--bs-border-color);
                ">
                  <div class="sidebar-options">

                    <button
                      name="settings"
                      class="subcontentOption"
                      data-subcontent="settings"
                      style="
                        display: block;
                        width: 100%;
                        background: none;
                        color: var(--bs-body-color);
                        border: none;
                        text-align: left;
                        padding: 10px;
                        font-size: 14px;
                        cursor: pointer;
                      ">
                      <i class="fa fa-cog"></i> Settings
                    </button>

                    <button
                      name="about"
                      class="subcontentOption"
                      data-subcontent="about"
                      style="
                        display: block;
                        width: 100%;
                        background: none;
                        color: var(--bs-body-color);
                        border: none;
                        text-align: left;
                        padding: 10px;
                        font-size: 14px;
                        cursor: pointer;
                      ">
                      <i class="fa fa-info-circle"></i> About
                    </button>

                  </div>
                </div>

                <div class="main-content" style="
                  flex: 1;
                  background-color: var(--bs-secondary-bg);
                  color: var(--bs-body-color);
                  padding: 20px;
                  overflow-y: auto;
                ">
                  <div class="subcontent"></div>
                </div>

              </div>
            `);

            this.attachEvents();
            this.loadPage("settings");
        }

        loadContent(content) {
            this.content.html(content);
        }

        attachEvents() {
            const _this = this;

            this.content.find(".subcontentOption")
              .on(UI.pointerEvent("click"), function (event) {
                event.preventDefault();
                _this.loadPage($(this).data("subcontent"));
              });
        }

        loadPage(subcontent) {
            if (!subcontent) return;

            this.content.find(".subcontentOption")
              .css("background", "none");

            this.content.find(`.subcontentOption[data-subcontent="${subcontent}"]`)
              .css("background", "var(--bs-gray-700)");

            this.loading(true);

            if (subcontent === "settings") {
              this.loadSubcontent(`
                <div class="settings">
                  <h2 style="
                    border-bottom: 1px solid var(--bs-border-color);
                    padding-bottom: 10px;
                    margin-bottom: 20px;
                  ">
                    Mod Settings
                  </h2>

                  <div class="form-group" style="margin-bottom: 20px;">
                    <label style="
                      display: block;
                      margin-bottom: 10px;
                      font-weight: bold;
                    ">
                      Features:
                    </label>

                      <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                        <input type="checkbox" name="custom-css" style="margin-right: 8px;">
                        Enable custom CSS
                      </label>
                    </div>
                  </div>

                  <div class="form-group" style="margin-bottom: 20px;">
                    <label style="
                      display: block;
                      margin-bottom: 8px;
                      font-weight: bold;
                    ">
                      Custom CSS:
                    </label>

                    <textarea
                      name="custom-css-input"
                      placeholder="Enter your custom CSS here..."
                      style="
                        width: 100%;
                        height: 200px;
                        padding: 10px;
                        background-color: var(--bs-gray-400);
                        color: var(--bs-body-color);
                        border: 1px solid var(--bs-border-color);
                        border-radius: 4px;
                        font-family: monospace;
                        font-size: 13px;
                        resize: vertical;
                      "
                    ></textarea>

                    <small style="
                      color: var(--bs-secondary-color);
                      display: block;
                      margin-top: 5px;
                    ">
                      Example: .userlistIcon { font-size: 16px; }
                    </small>
                  </div>

                  <button class="apply-button" style="
                    margin-top: 20px;
                    padding: 12px 24px;
                    background-color: var(--bs-primary);
                    color: var(--bs-emphasis-color);
                    border: 1px solid var(--bs-primary);
                    cursor: pointer;
                    border-radius: 4px;
                    font-size: 14px;
                    font-weight: bold;
                  ">
                    Apply Settings
                  </button>

                </div>
              `);

                if (window.modSettings) {
                
                    this.content.find("input[name='custom-css']")
                    .prop("checked", !!window.modSettings.customCssEnabled);

                    this.content.find("textarea[name='custom-css-input']")
                    .val(window.modSettings.customCss || "");
                }
                // --- END: LOADING SAVED DATA INTO UI ---


                // --- START: SAVING DATA ON APPLY ---
                this.content.find(".apply-button").on("click", () => {

                    const customCssEnabled =
                    this.content.find("input[name='custom-css']").prop("checked");

                    const customCss =
                    this.content.find("textarea[name='custom-css-input']").val();
                    
                    // Update the global settings object
                    window.modSettings ??= {};
                    Object.assign(window.modSettings, {
                    customCssEnabled,
                    customCss
                    });
                    
                    // SAVE TO LOCAL STORAGE
                    saveSettings(window.modSettings); 

                    if (customCssEnabled && customCss) {
                    this.applyCustomCss(customCss);
                    } else {
                    this.removeCustomCss();
                    }

                    const btn = this.content.find(".apply-button");
                    const originalText = btn.text();

                    btn
                    .text("✓ Applied!")
                    .css("background-color", "var(--bs-success)");

                    setTimeout(() => {
                    btn
                        .text(originalText)
                        .css("background-color", "var(--bs-primary)");
                    }, 2000);
                });
            }

            if (subcontent === "about") {
              this.loadSubcontent(`
                <div class="about">
                    <h2 style="
                        border-bottom: 1px solid var(--bs-border-color);
                        padding-bottom: 10px;
                        margin-bottom: 20px;
                    ">
                        About This Mod
                    </h2>

                  <h2 style="
                    color: var(--bs-body-color);
                    margin-top: 25px;
                    margin-bottom: 12px;
                    font-size: 16px;
                  ">
                    Key Features
                  </h2>

                  <p style="color: var(--bs-secondary-color); line-height: 1.6; margin-bottom: 8px;">
                    <strong style="color: var(--bs-body-color);">Modded User Network:</strong><br>
                    Connects to a private Deno server to identify other  modded users and sync with them. 
                    Also adds a little crown next to a modded user's name.
                  </p>

                  <p style="color: var(--bs-secondary-color); line-height: 1.6; margin-bottom: 8px;">
                    <strong style="color: var(--bs-body-color);">Auto Resolution:</strong><br>
                    Automatically adjusts to 2160x1920 resolution for XL board sizes.
                  </p>

                  <p style="color: var(--bs-secondary-color); line-height: 1.6; margin-bottom: 8px;">
                    <strong style="color: var(--bs-body-color);">Custom Styling:</strong><br>
                    Persistent custom CSS injection with built-in styling improvements.
                  </p>

                  <h3 style="
                    color: var(--bs-body-color);
                    margin-top: 25px;
                    margin-bottom: 12px;
                    font-size: 16px;
                    padding-top: 5px;
                    border-top: 1px solid var(--bs-border-color);
                  ">
                    Technical Details
                  </h3>

                  <p style="color: var(--bs-secondary-color); line-height: 1.6;">
                    <strong style="color: var(--bs-body-color);">Version:</strong> 1.2.2<br>
                    <strong style="color: var(--bs-body-color);">Platform:</strong> Tauri (Webview2)<br>
                    <strong style="color: var(--bs-body-color);">Server Source Code:</strong> 
                    <a href="https://github.com/devorous/flocksockets" 
                       style="color: var(--bs-link-color); text-decoration: none;"
                       target="_blank">github.com/devorous/flocksockets</a>
                  </p>

                  <h3 style="
                    color: var(--bs-body-color);
                    margin-top: 25px;
                    margin-bottom: 12px;
                    font-size: 16px;
                    padding-top: 5px;
                    border-top: 1px solid var(--bs-border-color);
                  ">
                    Recent Updates
                  </h3>

                  <p style="color: var(--bs-secondary-color); line-height: 1.6; font-size: 13px;">
                    • Implemented Zexium's connection monitor<br>
                    • Added mod settings menu with persistent storage<br>
                    • Improved troll detection and custom alert sounds<br>
                    • Made the chat colour scheme less blinding
                  </p>

                  <p style="
                    color: var(--bs-gray-600);
                    margin-top: 30px;
                    font-size: 12px;
                  ">
                    
                  </p>
                    <h3 style="
                        color: var(--bs-body-color);
                        margin-top: 25px;
                        margin-bottom: 12px;
                        font-size: 16px;
                        padding-top: 5px;
                        border-top: 1px solid var(--bs-border-color);
                        ">
                        Thanks & Credits
                    </h3>
                    <p style="color: var(--bs-secondary-color); line-height: 1.6; font-size: 13px;">
                        Thanks to <strong style="color: var(--bs-body-color);">Zexium</strong> for foundational mod ideas, 
                        connection monitoring, and troll detection logic that inspired and improved this project.<br><br>
                        Thanks to <strong style="color: var(--bs-body-color);">Sphoon</strong> for his work deciphering the code,
                        and helping set up the foundation for this work.
                    </p>
                </div>
              `);
            }

            this.loading(false);
        }

        loadSubcontent(content) {
            this.content.find(".subcontent").html(content);
        }

        loading(state) {
            if (state) {
              this.content.find(".subcontent").html(
                "<div class='loading' style='color: var(--bs-body-color);'>Loading...</div>"
              );
            }
        }

        applyCustomCss(css) {
            let styleTag = $("#flockmod-custom-css");
            if (!styleTag.length) {
              styleTag = $("<style id='flockmod-custom-css'>").appendTo("head");
            }
            styleTag.text(css);
        }

        removeCustomCss() {
            $("#flockmod-custom-css").remove();
        }
    };
}


function setupUI() {
    // Wait for jQuery to be available
    if (typeof $ === 'undefined') {
        setTimeout(setupUI, 100);
        return;
    }

    const buttonConfig = {
        name: 'modSettings',
        icon: 'fa-crown',
        param: 'Mod Settings'
    };
    const buttonSelector = `a[name="${buttonConfig.name}"]`;

    if($(buttonSelector).length > 0){
        console.log("Mod button already exists");
        return;
    }

    const newButtonHTML = `
        <li class="nav-item" data-tooltipcallback="tooltipShortcut" data-tooltipparam="${buttonConfig.param}">
            <a name="${buttonConfig.name}" class="nav-link" href="#">
                <i style="color: var(--bs-primary)" class="fas ${buttonConfig.icon}"></i>
                <span class="d-lg-none">
                    <span data-i18n="tooltip.lbl${buttonConfig.param}"></span>
                </span>
            </a>
        </li>
    `;

    const $targetContainer = $('.navbar-nav.topbarButtons'); 

    if ($targetContainer.length) {
        $targetContainer.prepend(newButtonHTML); 
        
        $(document).on('click', buttonSelector, function(e) {
            e.preventDefault(); 
            UI.dialogHandler.showDialog("modD");
        });
    } else {
        console.error('Target container not found - retrying...');
        setTimeout(setupUI, 100);
    }
}





class MessageHandler{
    /* Example commands include
    JOINED
    LEFT
    INTHEROOM
    BROADCAST
    IMG
    CHATMSG
    */
    constructor(){
        this.handlers = new Map();  
    }
    register(command, callback, context){
        if(!this.handlers.has(command)){
            this.handlers.set(command, []);
        }
        this.handlers.get(command).push({callback, context});
    }
    unregister(command, context){
        if (this.handlers.has(command)){
            const handlers = this.handlers.get(command);
            this.handlers.set(command, handlers.filter(h => h.context !== context));
        }
    }
    handle(message){
        const json = JSON.parse(decryptMessage(message.data, socket.encryption));
        if (this.handlers.has(json.command)){
            const handlers = this.handlers.get(json.command);

            handlers.forEach(({callback, context}) =>{
                callback.call(context, json);
            });
        }
    }
}

class BroadcastHandler {
    constructor() {
        this.handlers = new Map();

        this.broadcastTypes = {
            PEN_DOWN: 'Pd',
            PEN_UP:   'Pu',
            PEN_MOVE: 'Pm',
            PEN_HIDE: 'Phi',
            PEN_SHOW: 'Psh',
            BRUSH_CHANGE: 'Bch',
        };
    }

    register(broadcastType, callback, context) {
        if (!this.handlers.has(broadcastType)) {
            this.handlers.set(broadcastType, []);
        }
        this.handlers.get(broadcastType).push({ callback, context });
    }

    unregister(broadcastType, context) {
        if (this.handlers.has(broadcastType)) {
            const handlers = this.handlers.get(broadcastType);
            this.handlers.set(broadcastType, handlers.filter(h => h.context !== context));
        }
    }

    handle(message) {
        const type = message.action; // Assuming first element is type
        
        // Dispatch to all registered handlers for this type
        if (this.handlers.has(type)) {
            const handlers = this.handlers.get(type);
            handlers.forEach(({ callback, context }) => {
                callback.call(context, message, message);
            });
        }
    }
}

class ActionHandler {
    constructor(message) {

    }
    parse_action(action) {
        switch (action.type) {
            case 'vote':
                break;
            case 'nominate':
                break;
        }
    }
}




class Copier {
    constructor(messageHandler) {
        this.active = false;
        this.user = "";
        this.mirrorX = false;
        this.mirrorY = false;
        this.xOffset = 0;
        this.yOffset = 0;

        // Register with message handler
        if (messageHandler) {
            this.registerHandlers(messageHandler);
        }
    }

    registerHandlers(messageHandler) {
        messageHandler.register('BROADCAST', this.onBroadcast, this);
        messageHandler.register('IMG', this.onImage, this);
        messageHandler.register('CHATMSG', this.onChatMessage, this);
    }

    copyD() {
        this.user = "D";
        this.active = true;
        this.mirrorX = true;
    }

    toggleCopier() {
        this.active = !this.active;
        console.log(`Copier is ${this.active ? "Active" : "Not Active"}`);
    }

    onBroadcast(message) {
        if (this.active && message.from === this.user) {
            drawbot.copyAction(message);
        }
    }

    onImage(message) {
        // In order to mirror this, I will need to be able to press the flip button
        // As well as incorporate the width/height and position into the mirror equation
    }

    onChatMessage(message) {
        if (message.message.split("")[0] === "!") {
            this.handleCommand(message.message, message.from, message.chattype || "room");
            console.log("Action: ", message.message);
        }
    }

    handleCommand(message, username, chattype) {
        const parts = message.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        switch (command) {
            case '!vote':
                if (args.length > 0) {
                    const vote = args[0];
                    if (drawgame && drawgame.voteManager) {
                        drawgame.voteManager.addVote(vote, username, chattype);
                    }
                } else {
                    drawbot.send_pm(username, "Usage: !vote <option>");
                }
                break;

            case '!nominate':
                if (args.length > 0) {
                    const nomination = args.join(" ");
                    if (drawgame) {
                        drawgame.nominate(username, nomination);
                        drawbot.send_pm(username, `Nominated: ${nomination}`);
                    }
                } else {
                    drawbot.send_pm(username, "Usage: !nominate <theme>");
                }
                break;

            default:
                console.log("Unknown command:", command);
        }
    }
}

class Drawbot {
    constructor() {
        this.animate = true;
        this.animationDelay = 15;
        this.board = window.room.board
        this.boardHeight = window.room.board.canvasHeight;
        this.boardWidth = window.room.board.canvasWidth;
        this.users = window.room.users;
        this.socket = window.socket;

        this.select_toolbar = $(".floatingToolbar")[0];
        this.clear_button = this.select_toolbar.children[0];
        this.fill_button = this.select_toolbar.children[1];
        this.save_button = this.select_toolbar.children[4];

        // Helper functions for drawing actions (bound to myself)
        this.pd = (x, y) => room.myself.surface.penDown(x, y);
        this.pm = (x, y) => room.myself.surface.penMove(x, y);
        this.pu = (x, y) => room.myself.surface.penUp(x, y);
        this.pcl = () => room.myself.surface.penCancel();
        this.psh = () => room.myself.surface.penShow();
        this.phi = () => room.myself.surface.penHide();

        this.cch = (color) => room.myself.surface.setColor(color);
        this.bch = (brush) => room.myself.surface.setBrush(brush);
        this.bop = (option, value) => room.myself.surface.setBrushOption(option, value);
        this.upm = (status) => room.myself.surface.setUploadMode(status);
        this.sic = (x, y, width, height, rotation) => room.myself.surface.drawSilhouette(x, y, width, height, rotation);
        this.la = (layer) => room.myself.surface.setCurrentLayer(layer);
        this.kp = (key) => room.myself.surface.keyPress(key);
        this.mfd = (code) => room.myself.surface.modifierDown(code);
        this.mfu = (code) => room.myself.surface.modifierUp(code);
        this.brp = (parameters, brush) => room.myself.surface.brushParameter(parameters, brush);
        this.uch = (newname) => room.myself.changeUsername(newname);
        this.sch = (status) => room.myself.changeStatus(status);
        this.ich = (status) => room.myself.changeInactive(status);
        this.dch = (inputDevice) => room.myself.changeInputDevice(inputDevice);
    }

    send_msg(type, name, msg) {
        let socketMessage = {
            command: "USERFUNCTIONS",
            option: "CHAT",
            chattype: type,
            chatname: name,
            message: msg
        };

        this.socket.send(JSON.stringify(socketMessage));
    }
    send_pm(user, msg) {
        this.send_msg("user", user, msg);
    }

    send_chat(msg) {
        this.send_msg("room", "public", msg);
    }

    copyAction(message) {
        let nmessage = {
            ...message
        };
        delete nmessage.time;
        delete nmessage.from;
        if (nmessage.brush === "blend") {
            nmessage.parameters = this.alterAction(nmessage.parameters);
        } else {
            nmessage = this.alterAction(nmessage);
        }
        switch (nmessage.action) {
            // --- Coordinate Actions (x, y) ---
            case 'Pd':
                this.pd(nmessage.x, nmessage.y);
                break;
            case 'Pm':
                this.pm(nmessage.x, nmessage.y);
                break;
            case 'Pu':
                this.pu(nmessage.x, nmessage.y);
                break;
            case 'Sic': // drawSilhouette(x, y, width, height, rotation)
                this.sic(nmessage.x, nmessage.y, nmessage.width, nmessage.height, nmessage.rotation);
                break;
                // --- Brush/Color/Option Actions ---
            case 'Cch': // setColor(color)
                this.cch(nmessage.color);
                break;
            case 'Bch': // setBrush(brush)
                this.bch(nmessage.brush);
                break;
            case 'Bop': // setBrushOption(option, value)
                this.bop(nmessage.option, nmessage.value);
                break;
            case 'Brp': // brushParameter(parameters, brush)
                this.brp(nmessage.parameters, nmessage.brush);
                break;

            case 'Kp': // keyPress(key)
                this.kp(nmessage.key);
                break;
        }
        socket.send(JSON.stringify(nmessage));
    }

    alterAction(message) {
        let altered = {
            ...message
        };
        if (copier.mirrorX) {
            altered.x = this.boardWidth - altered.x;
        }
        if (copier.mirrorY) {
            altered.y = this.boardHeight - altered.y;
        }
        if (copier.xOffset !== 0) {
            altered.x += copier.xOffset;
        }
        if (copier.yOffset !== 0) {
            altered.y += copier.yOffset;
        }
        return altered;
    }

    stopAnim() {
        this.animate = false;
    }

    async resetAnim() {
        this.animate = false;
        await this.wait(100);
        this.animate = true;
    }

    // Returns a promise that resolves after ms milliseconds
    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    setDelay(ms) {
        if (typeof ms === 'number' && ms >= 0) {
            this.animationDelay = ms;
            console.log(`Animation delay set to ${this.animationDelay}ms`);
        } else {
            console.warn("Invalid delay value. Please provide a non-negative number.");
        }
    }

    // Kept logic as requested, but marked async to allow awaiting in chains
    async click(x, y) {
        this.pd(x, y);
        this.pu(x, y);
    }

    async change_size(size) {
        this.bop("size", size);
    }

    async change_colour(colour) {
        this.cch(colour);
    }

    async create_text(text, x, y) {
        this.bch("text");
        this.pm(x, y);
        await this.click(x, y); // Await incase click needs time

        for (let key of text) {
            let ascii = key.charCodeAt(0)
            this.kp(ascii);
        }
        await this.wait(5);
        await this.click(x, y);
        this.bch("pen");
    }

    async draw_rect(size, x1, x2, y1, y2, color = "#000") {
        this.cch(color);
        this.bop("size", size);
        this.bch("rect");

        this.pd(x1, y1);
        await this.wait(2); // Necessary pause for start of shape

        this.pm(x2, y2);
        await this.wait(2); // Necessary pause for end of shape

        this.pu(x2, y2);
    }

    // Integrated save_rect here to fix scope issues
    async save_rect(x1, x2, y1, y2) {
        this.psh();
        this.bch("selection");
        this.pm(x1, y1);
        this.pd(x1, y1);
        this.pm(x2, y1);
        this.pm(x2, y2);
        this.pm(x1, y2);
        this.pu();
        this.phi();

        // Click the built-in save button in the toolbar
        this.save_button.click();

        // Wait for the Flockmod popup to appear
        await this.wait(500);
        $('a[name="saveGallery"]').click(); // The "Save to Gallery" button

        // Wait for the save to register
        await this.wait(800);
        $('div[name="save"] a.closeButton').click(); // Close the popup
    }

    async fill_rect(x1, x2, y1, y2) {
        //this.psh();

        this.bch("selection");

        // Ensure tool switch registers
        await this.wait(10);

        this.pm(x1, y1);
        this.pd(x1, y1);
        this.pu(x1, y1);
        this.pd(x1, y1);
        this.pm(x2, y1);
        this.pm(x2, y2);
        this.pm(x1, y2);
        this.pm(x1, y1);
        this.pu();
        this.phi();

        await this.wait(20); // Wait for selection to finalize
        this.fill_button.click();
        await this.wait(10);
    }

    async clear_rect(x1, x2, y1, y2) {

        this.bch("selection");
        // Ensure tool switch registers
        await this.wait(10);

        this.pm(x1, y1);
        this.pd(x1, y1);
        this.pu(x1, y1);
        this.pd(x1, y1);
        this.pm(x2, y1);
        this.pm(x2, y2);
        this.pm(x1, y2);
        this.pm(x1, y1);
        this.pu();
        this.phi();

        await this.wait(20); // Wait for selection to finalize
        this.clear_button.click();
        await this.wait(10);
    }


    async draw_grid(size, x1, x2, y1, y2, rows, cols, delay = 15) {
        let x_step = (x2 - x1) / rows;
        let y_step = (y2 - y1) / cols;

        // Draw border
        await this.draw_rect(size, x1, x2, y1, y2);
        await this.wait(delay);

        // Draw vertical lines
        for (let i = 1; i < rows; i++) {
            let x_start = x1 + x_step * i;
            let x_end = x_start + x_step;

            await this.draw_rect(size, x_start, x_end, y1, y2);
            await this.wait(delay);
        }

        // Draw horizontal lines
        for (let j = 1; j < cols; j++) {
            let y_start = y1 + y_step * j;
            let y_end = y_start + y_step;

            await this.draw_rect(size, x1, x2, y_start, y_end);
            await this.wait(delay);
        }
    }

    async strobe(delay) {
        while (this.animate) {
            this.psh();
            await this.wait(delay);
            this.phi();
            await this.wait(delay);
        }
    }

    async rainbow() {
        while (this.animate) {
            await this.wait(this.animationDelay);
            let color = room.myself.surface.drawColor;
            let r, g, b;

            if (color.split("")[0] === "#") {
                let rgb = hex2rgb(color);
                r = rgb.r;
                g = rgb.g;
                b = rgb.b;
            } else {
                let rgbMatch = color.match(/\d+/g);
                r = parseInt(rgbMatch[0]);
                g = parseInt(rgbMatch[1]);
                b = parseInt(rgbMatch[2]);
            }

            let hsv = rgb2hsv(r, g, b);
            hsv.h += 1;
            if (hsv.h > 360) {
                hsv.h = hsv.h - 360;
            }

            let newrgb = hsv2rgb(hsv.h, hsv.s, hsv.v);
            let newcolor = `rgb(${newrgb.r}, ${newrgb.g}, ${newrgb.b})`
            let hex = rgb2hex(newcolor);
            this.cch(hex);
        }
    }

    async dvd(startx = null, starty = null, size = null, speed = null, boardHeight = this.boardHeight, boardWidth = this.boardWidth) {
        if (startx === null) {
            startx = Math.floor(Math.random() * (boardWidth - 50 + 1)) + 50;
        }
        if (starty === null) {
            starty = Math.floor(Math.random() * (boardHeight - 50 + 1)) + 50;
        }
        if (size === null) {
            size = Math.floor(Math.random() * (40 - 10 + 1)) + 10;
        }
        if (speed === null) {
            speed = Math.floor(Math.random() * (12 - 5 + 1)) + 5;
        }

        this.bop("size", size);
        this.psh();
        this.pm(startx, starty);

        let angle = Math.random() * 2 * Math.PI;
        let vx = Math.cos(angle) * speed;
        let vy = Math.sin(angle) * speed;
        let x = startx;
        let y = starty;

        while (this.animate) {
            if (x + vx + size / 2 > boardWidth || x + vx - size / 2 < 0) {
                vx = -vx;
            }
            if (y + vy + size / 2 > boardHeight || y + vy - size / 2 < 0) {
                vy = -vy;
            }

            x += vx;
            y += vy;
            x = Math.max(size / 2, Math.min(x, boardWidth - size / 2));
            y = Math.max(size / 2, Math.min(y, boardHeight - size / 2));

            await this.wait(this.animationDelay);
            this.pm(x, y);
        }
    }
}


class Timer {
    constructor(x, y, callback = () => {}) {
        this.x = x;
        this.y = y;
        this.intervalId = null;
        this.remainingTime = 0;
        this.callback = callback;
        this.isRunning = false;

        // Calculate dimensions for clearing
        this.labelWidth = 250;
        this.timerWidth = 80;
        this.height = 40;
    }

    async start(duration) {
        if (this.isRunning) {
            this.stop();
        }

        this.remainingTime = duration;
        this.isRunning = true;

        await this.drawTimerLabel();
        await this.updateDisplay();

        this.intervalId = setInterval(async () => {
            this.remainingTime--;
            if (this.remainingTime >= 0) {
                await this.updateDisplay();
            } else {
                this.stop();
                this.callback();
            }
        }, 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.isRunning = false;
        }
    }

    async drawTimerLabel() {
        // Clear the label area first
        await drawbot.draw_rect(40, this.x + 10, this.x + 60, this.y - 20, this.y + 18, "#000");

        await drawbot.change_colour("#FFF");
        await drawbot.change_size(20);
        await drawbot.create_text("Time Remaining:", this.x - 235, this.y - 2);
    }

    async updateDisplay() {
        // Clear the timer display area
        await drawbot.draw_rect(40, this.x + 10, this.x + 60, this.y - 20, this.y + 18, "#000");

        // Calculate time
        let minutes = Math.floor(this.remainingTime / 60);
        let seconds = this.remainingTime % 60;

        // Format seconds with leading zero
        let secondsStr = seconds < 10 ? "0" + seconds : seconds.toString();

        // Set color based on time remaining
        if (this.remainingTime < 60) {
            await drawbot.change_colour("#F00"); // Red for last minute
        } else {
            await drawbot.change_colour("#FFF"); // White otherwise
        }

        await drawbot.change_size(20);

        let text = `${minutes}:${secondsStr}`;
        await drawbot.create_text(text, this.x + 15, this.y);
    }

    async clear() {
        this.stop();

        // Clear both label and timer areas
        await drawbot.cch("#000");
        await drawbot.fill_rect(
            this.x - this.labelWidth,
            this.x + this.timerWidth,
            this.y - 20,
            this.y + 18
        );
    }
}

class Drawgame {
    constructor(x1, x2, y1, y2, config = {}) {
        this.round = 0;
        this.x1 = x1;
        this.x2 = x2;
        this.y1 = y1;
        this.y2 = y2;
        this.config = {
            minPlayers: 4,
            nominationTime: 10,
            voteTime: 10,
            roundLength: 20,
            ...config
        };
        this.cols = 0;
        this.rows = 0;
        this.max_users = 0;
        this.prev_max_users = 0;
        this.xStep = 0;
        this.yStep = 0;
        this.headheight = 60;
        this.theme = "";
        this.userList = [];
        this.num_users = 0;
        this.prev_users = 0;
        this.nominations = {};
        this.timer = null;
        this.voteManager = new VoteManager();
        this.continue = true;
        this.themes = ["a butterfly", "a house", "a mushroom", "a waterfall", "a bicycle", "a fireplace", "a garden", "a coastline", "a chicken", "a balloon", "a tree", "fire", "a riverbank", "a market", "a meadow", "a lighthouse", "a road", "a vineyard", "a windmill", "a pier", "a field", "a pond", "a street", "a picnic spot", "a flower", "a waterfall", "a bridge", "an orchard", "a city park", "a stream", "a flower shop", "a lakeside dock", "a cafe", "a barn", "a city square", "a vineyard", "a beach boardwalk", "a town carnival", "a dark alley", "a cloud", "treasure", "a worm", "an apple", "a pillow", "a cactus", "a bird", "a hopping frog", "a dog", "a bee", "a basketball", "a rainbow", "a shiny beetle", "a campfire", "a candle", "a puddle", "a butterfly", "a rocket", "a flowing river", "a mountain", "a lion", "a eagle", "a glowing firefly", "a car", "a caterpillar", "a parrot", "a cricket", "a wolf", "a mouse", "a treasure", "a castle", "a dragon", "a pirate", "a robot", "a unicorn", "space", "magic", "a wizard", "an adventure", "a fairy", "a monster", "a superhero", "a ninja", "an alien", "a dinosaur", "an explorer", "a mermaid", "a knight", "a vampire", "a zoo", "a jungle", "an ocean", "a forest", "a desert", "a mountain", "a volcano", "an island", "a planet", "a moon", "a star", "a comet", "a galaxy", "a robot", "a machine", "a castle", "a fortress", "a laboratory", "an invention", "a factory", "a lion", "a tiger", "an elephant", "a dolphin", "a penguin", "a kangaroo", "a giraffe", "a zebra", "a monkey", "a bear", "a whale", "a falcon", "a rabbit", "a snake", "a crocodile", "a shark", "a parrot", "a fox", "a deer", "a cheetah", "a hippo", "a llama", "a seal", "a bat", "a moose", "a tortoise", "a platypus", "a jellyfish", "a sloth", "a bison"];
    }

    async start() {
        this.continue = true;
        while (this.continue) {
            try {
                this.round++;
                await this.setupGrid();
                await this.nominationPhase();
                await this.themeVotingPhase();
                await this.drawingPhase();
                await this.votingPhase();
                await this.announceWinners();
                drawbot.send_chat("Resetting in 10 seconds...");
                await this.delay(10000);
            } catch (error) {
                console.error("Error in game flow:", error);
                drawbot.send_chat("An error occurred. The game will restart.");
                await this.delay(5000);
            }
        }
    }

    stop() {
        this.continue = false;
        drawbot.send_chat("Game cancelled; last round!");
        if (this.timer) {
            this.timer.stop();
        }
    }

    async setupGrid() {
        this.updateUserList();
        this.calculateGridDimensions();
        this.max_users = this.cols * this.rows;

        // Draw Border first
        await this.drawGameBorder();
        console.log("Round:", this.round);

        if (this.round == 1) {
            // First round: Just draw grid and names
            await this.drawGrid();
            await this.drawUsernames();
        }

        if (this.round > 1) {
            if (this.max_users != this.prev_max_users) {
                // Grid size changed: Save board -> Wait -> Clear -> Redraw
                console.log("Grid size has changed, redrawing grid...");
                drawbot.send_chat("Grid size changed, board will be erased in 15 seconds.");
                drawbot.send_chat("The current board will be saved automatically.");

                await drawbot.save_rect(0, 1920, 0, 1080);
                await this.delay(15000);
                await drawbot.clear_rect(0, 1920, this.y1 + this.headheight, 1080);
                await this.drawGrid();
                await this.drawUsernames();
            } else {
                await this.drawUsernames();
                await this.drawGrid();
            }
        } else {
            await this.drawUsernames();
            await this.drawGrid();
        }

        this.prev_users = this.num_users;
        this.prev_max_users = this.cols * this.rows;
    }

    updateUserList() {
        try {
            this.userList = Object.values(drawbot.users)
                .filter(user => user && user.username)
                .map(user => user.username);

            this.num_users = this.userList.length + 1; // +1 for Free Space
        } catch (error) {
            console.error("Error updating user list:", error);
            this.userList = [];
            this.num_users = 1;
        }
    }

    calculateGridDimensions() {
        let total = Math.max(this.num_users, this.config.minPlayers);
        this.cols = Math.ceil(Math.sqrt(total));
        this.rows = Math.ceil(total / this.cols);
        this.xStep = (this.x2 - this.x1) / this.rows;
        this.yStep = (this.y2 - (this.y1 + this.headheight)) / this.cols;
    }

    async drawGameBorder() {
        await drawbot.draw_rect(50, this.x1, this.x2, this.y1, this.y1 + 40, "#000");
        await drawbot.change_colour("#FFF");
        await drawbot.change_size(20);
        await drawbot.create_text(`Round ${this.round}`, this.x1 + 420, this.y1 + 26);
        await drawbot.create_text("DrawGame", this.x2 - 220, this.y1 + 26);
    }

    async drawGrid() {
        await drawbot.draw_grid(8, this.x1, this.x2, this.y1 + this.headheight, this.y2, this.rows, this.cols);
    }

    async drawUsernames() {
        await drawbot.change_colour("#000");
        await drawbot.change_size(8);
        let total = Math.max(this.num_users, this.config.minPlayers);
        let index = 0;

        for (let i = 0; i < this.cols; i++) {
            for (let j = 0; j < this.rows; j++) {
                let name;
                if (index < this.userList.length) {
                    name = this.userList[index];
                } else {
                    name = "Free Space";
                }

                await drawbot.wait(20);

                await drawbot.clear_rect(
                    this.x1 + j * this.xStep + 4,
                    this.x1 + j * this.xStep + 30 + name.length * 8,
                    this.y1 + this.headheight + i * this.yStep + 5,
                    this.y1 + this.headheight + i * this.yStep + 25
                );
                await drawbot.wait(20);
                await drawbot.create_text(
                    name,
                    this.x1 + 5 + j * this.xStep,
                    this.y1 + 15 + this.headheight + i * this.yStep
                );
                await drawbot.wait(20);
                index++;
            }
        }
    }

    async nominationPhase() {
        drawbot.send_chat(`Nominate a drawing theme using !nominate <theme> (${this.config.nominationTime}s remaining)`);
        await this.delay(this.config.nominationTime * 500);
        drawbot.send_chat(`${this.config.nominationTime / 2} seconds remaining...`);
        await this.delay(this.config.nominationTime * 500);
    }

    async themeVotingPhase() {
        const options = this.prepareThemeOptions();
        this.voteManager.startVote("theme", "D", options, this.config.voteTime);
        await this.delay(this.config.voteTime * 1000);
        await this.announceTheme();
    }

    prepareThemeOptions() {
        let noms = Object.values(this.nominations);
        const letters = ["A", "B", "C", "D", "E", "F"];
        const options = {};
        const rands = new Set();

        noms.forEach((nom, i) => {
            if (i < letters.length) {
                options[letters[i]] = nom;
            }
        });

        while (Object.keys(options).length < Math.min(6, Math.max(4, noms.length))) {
            let randi;
            do {
                randi = Math.floor(Math.random() * this.themes.length);
            } while (rands.has(randi) || this.themes.length === 0);

            if (this.themes.length === 0) break; // Safety check

            rands.add(randi);
            options[letters[Object.keys(options).length]] = this.themes[randi];
        }
        return options;
    }

    async announceTheme() {
        const winners = this.voteManager.winners;
        const theme = winners.length > 1 ? winners[Math.floor(Math.random() * winners.length)] : winners[0];
        drawbot.send_chat(`The next theme is ${theme}!`);
        await this.setTheme("Draw " + theme);
    }

    async drawingPhase() {
        this.nominations = {};

        // Create and start timer with callback
        this.timer = new Timer(
            this.x1 + (this.x2 - this.x1) * 0.17,
            this.y1 + 26,
            () => {
                console.log("Drawing phase complete!");
            }
        );

        // AWAIT the timer start so it draws before continuing
        await this.timer.start(this.config.roundLength);

        // Simple delay instead of redundant loop
        // Send reminders at specific intervals
        const warningTimes = [60, 30];
        let elapsed = 0;

        while (elapsed < this.config.roundLength) {
            await this.delay(1000);
            elapsed++;

            const remaining = this.config.roundLength - elapsed;
            if (warningTimes.includes(remaining)) {
                drawbot.send_chat(`${remaining} seconds remaining!`);
            }
        }

        // Clean up timer
        if (this.timer) {
            await this.timer.clear();
        }
    }

    async votingPhase() {
        this.voteManager.startVote("drawgame", "D", this.userList, this.config.voteTime);
        await this.delay(this.config.voteTime * 1000);
    }

    async announceWinners() {
        const winners = this.voteManager.winners;

        if (winners.length > 1) {
            drawbot.send_chat("It's a tie!");
            drawbot.send_chat(`The winners are: ${winners.join(" and ")}!`);
        } else {
            drawbot.send_chat(`The winner is ${winners[0]}!`);
        }

        const voteCountStr = JSON.stringify(this.voteManager.voteCounts)
            .replace(/[\{\}"]/g, '')
            .replace(/,/g, ', ');
        drawbot.send_chat(voteCountStr);

        // Highlight winners one by one
        for (const winner of winners) {
            await this.highlightWinner(winner);
        }
    }

    async highlightWinner(user) {
        const index = this.userList.indexOf(user);
        if (index !== -1) {
            const row = index % this.rows;
            const col = Math.floor(index / this.rows);

            let extra = col === 0 ? 1 : 0;
            let x1 = this.x1 + row * this.xStep;
            let x2 = this.x1 + (row + 1) * this.xStep;
            let y1 = this.y1 + this.headheight + col * this.yStep + extra;
            let y2 = this.y1 + this.headheight + (col + 1) * this.yStep;

            await drawbot.draw_rect(8, x1, x2, y1, y2, "#ffd736");
        } else {
            console.warn(`Winner ${user} not found in user list.`);
        }
    }

    async setTheme(theme) {
        this.theme = theme;
        await drawbot.change_colour("#FFF");
        await drawbot.change_size(20);
        await drawbot.create_text(theme, this.x1 + (this.x2 - this.x1) * 0.44, this.y1 + 26);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    nominate(user, nomination) {
        // Don't accept nominations if not in nomination phase
        if (!this.voteManager || this.voteManager.started) {
            drawbot.send_pm(user, "Not currently accepting nominations");
            return false;
        }

        // Limit nomination length
        if (nomination.length > 50) {
            drawbot.send_pm(user, "Nomination too long (max 50 characters)");
            return false;
        }

        this.nominations[user] = nomination;
        console.log(`${user} nominated: ${nomination}`);
        return true;
    }
}

class VoteManager {
    constructor() {
        this.started = false;
        this.votes = {};
        this.voteCounts = {};
        this.options = {};
        this.winners = [];
        this.type = null;
        this.voteDuration = 30; // Default to 30 seconds (multiplied to ms in startVote)
    }
    reset() {
        this.started = false;
        this.votes = {};
        this.voteCounts = {};
        this.options = {};
        this.winners = [];
        this.type = null;
    }
    startVote(type, user, options = {}, duration = 30) {
        this.started = true;
        this.options = options; //used in the get winners
        this.votes = {};
        this.winners = [];
        this.voteDuration = duration * 1000; // Set the custom duration
        let message;
        drawbot.send_chat("----------------------------------");
        this.type = type;
        switch (type) {
            case "theme":
                message = "Vote for the next theme!";
                break;
            case "drawgame":
                message = "Vote for your favourite art!";
                break;
            case "kick":
                message = `Vote to kick user ${user}? [y/n]`;
                options = ['y', 'n'];
                break;
        }

        console.log(`${message} (${options}) `);

        drawbot.send_chat(`${message} (${duration}s remaining):`);

        if (this.type == "drawgame") {
            drawbot.send_chat("Use !vote <user> in PM or public chat");
        } else if (this.type == "kick") {
            drawbot.send_chat("Use !vote y or !vote n in PM or public chat");
            drawbot.send_chat(`(${options[0]}) or (${options[1]})`);
        } else {
            let o_keys = Object.keys(options);
            let o_values = Object.values(options);
            drawbot.send_chat("Use !vote A/B/C/etc in PM or public chat");
            for (let i = 0; i < o_keys.length; i += 2) {
                if (o_keys[i + 1]) {
                    drawbot.send_chat(`(${o_keys[i]}): ${o_values[i]}, (${o_keys[i+1]}): ${o_values[i+1]} `);
                } else {
                    drawbot.send_chat(`(${o_keys[i]}): ${o_values[i]}`);
                }
            }
        }

        setTimeout(() => {
            drawbot.send_chat(`${this.voteDuration / 2000} seconds remaining...`); // Display half time
        }, this.voteDuration / 2);

        setTimeout(() => {
            this.getWinners();
        }, this.voteDuration);
    }

    addVote(vote, user, chattype) {
        if (!this.started) {
            drawbot.send_pm(user, "No ongoing vote.");
            return;
        }

        console.log("chat type: ", chattype);

        // Send confirmation (only PM for private votes, always for drawgame)
        const shouldConfirm = chattype === "user" || this.type === "drawgame";
        if (shouldConfirm) {
            drawbot.send_pm(user, `Vote ${vote} added`);
        }

        // Prevent self-voting in drawgame (case-insensitive)
        if (this.type === "drawgame" && vote.toLowerCase() === user.toLowerCase()) {
            console.log("Not adding vote: can't vote for self!");
            drawbot.send_pm(user, "You can't vote for yourself, nerd!");
            drawbot.send_chat(`${user} attempted to vote for themself!`);
            return;
        }

        // Process vote based on type
        let processedVote;
        if (this.type === "drawgame") {
            // Case-insensitive match for usernames
            const matchedUsername = this.options.find(
                username => username.toLowerCase() === vote.toLowerCase()
            );
            if (!matchedUsername) {
                drawbot.send_pm(user, "Invalid vote: user not found");
                return;
            }
            processedVote = matchedUsername;
        } else {
            // For theme/kick votes, convert to lowercase
            processedVote = vote.toLowerCase();

            // Validate vote option exists
            const validOptions = Array.isArray(this.options) ?
                this.options :
                Object.keys(this.options);

            if (!validOptions.map(o => o.toLowerCase()).includes(processedVote)) {
                drawbot.send_pm(user, `Invalid vote. Choose from: ${validOptions.join(", ")}`);
                return;
            }
        }

        console.log("Adding vote: ", processedVote, " from: ", user);
        this.votes[user] = processedVote;
    }


    getWinners() {
        this.started = false;
        const voteCounts = {};
        let voteOptions;

        // Determine vote options based on the type of this.options
        if (Array.isArray(this.options)) {
            voteOptions = this.options;
        } else {
            voteOptions = Object.values(this.options);
        }

        // Handle case when no votes are cast
        if (Object.keys(this.votes).length === 0) {
            if (this.type === "kick") {
                console.log("Nobody voted");
                this.winners = [];
            } else {
                console.log("Nobody voted: Picking random winner");
                drawbot.send_chat("Nobody voted! Picking a random winner");
                const randomIndex = Math.floor(Math.random() * voteOptions.length);
                const randomWinner = voteOptions[randomIndex];
                this.winners = [randomWinner];
                console.log(`The winner is: ${randomWinner}`);
            }
            return;
        }

        // Count the votes for each option
        for (const vote of Object.values(this.votes)) {
            voteCounts[vote] = (voteCounts[vote] || 0) + 1;
        }

        let maxVotes = 0;
        let winners = [];

        // Determine the options with the highest vote count
        for (const [option, count] of Object.entries(voteCounts)) {
            if (count > maxVotes) {
                maxVotes = count;
                winners = [option];
            } else if (count === maxVotes) {
                winners.push(option);
            }
        }

        // Convert winning options to their corresponding values if necessary
        if (!Array.isArray(this.options)) {
            winners = winners.map(winner => this.options[winner]);
        }

        this.winners = winners;

        const winnerText = winners.length > 1 ? winners.join(", ") : winners[0];
        console.log(`Winner(s): ${winnerText}`);
        this.voteCounts = voteCounts;
    }
}




const customCss = `:root, [data-bs-theme=D] {
    --bs-btn-bg: #1b252f;
    --bs-blue: #4a90e2;
    --bs-indigo: #7c5cdb;
    --bs-purple: #9b6dd6;
    --bs-pink: #e85d99;
    --bs-red: #e74c3c;
    --bs-orange: #ff8c42;
    --bs-yellow: #ffb347;
    --bs-green: #2ecc71;
    --bs-teal: #1abc9c;
    --bs-cyan: #3498db;
    --bs-black: #000;
    --bs-white: #fff;
    --bs-gray: #95a5a6;
    --bs-gray-dark: #2c3e50;
    --bs-gray-100: #10171e;
    --bs-gray-200: #2c3e50;
    --bs-gray-300: #17232f;
    --bs-gray-400: #1e2c39;
    --bs-gray-500: #212829ff;
    --bs-gray-600: #283435ff;
    --bs-gray-700: #566573;
    --bs-gray-800: #34495e;
    --bs-gray-900: #2c3e50;
    --bs-primary: #ff8c42;
    --bs-secondary: #566573;
    --bs-success: #2ecc71;
    --bs-info: #3498db;
    --bs-warning: #ffb347;
    --bs-danger: #e74c3c;
    --bs-light: #34495e;
    --bs-dark: #1a1a1a;
    --bs-primary-rgb: 255, 140, 66;
    --bs-secondary-rgb: 86, 101, 115;
    --bs-success-rgb: 46, 204, 113;
    --bs-info-rgb: 52, 152, 219;
    --bs-warning-rgb: 255, 179, 71;
    --bs-danger-rgb: 231, 76, 60;
    --bs-light-rgb: 52, 73, 94;
    --bs-dark-rgb: 26, 26, 26;
    --bs-primary-text-emphasis: #ffb885;
    --bs-secondary-text-emphasis: #95a5a6;
    --bs-success-text-emphasis: #5ddb8c;
    --bs-info-text-emphasis: #6bb6e8;
    --bs-warning-text-emphasis: #ffc98a;
    --bs-danger-text-emphasis: #f17a6d;
    --bs-light-text-emphasis: #95a5a6;
    --bs-dark-text-emphasis: #95a5a6;
    --bs-primary-bg-subtle: #1a2631;
    --bs-primary-bg: #34495fff; 
    --bs-secondary-bg-subtle: #1e252c;
    --bs-success-bg-subtle: #0f3d23;
    --bs-info-bg-subtle: #142e43;
    --bs-warning-bg-subtle: #4d3415;
    --bs-danger-bg-subtle: #451712;
    --bs-light-bg-subtle: #263238;
    --bs-dark-bg-subtle: #0d0d0d;
    --bs-primary-border-subtle: #994d1f;
    --bs-secondary-border-subtle: #3d4a56;
    --bs-success-border-subtle: #1f7a47;
    --bs-info-border-subtle: #2472a4;
    --bs-warning-border-subtle: #cc7a1f;
    --bs-danger-border-subtle: #a62820;
    --bs-light-border-subtle: #34495e;
    --bs-dark-border-subtle: #1a1a1a;
    --bs-white-rgb: 255, 255, 255;
    --bs-black-rgb: 0, 0, 0;
    --bs-font-sans-serif: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", "Liberation Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    --bs-font-monospace: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    --bs-gradient: linear-gradient(180deg, rgba(255, 140, 66, 0.15), rgba(255, 140, 66, 0));
    --bs-body-font-family: var(--bs-font-sans-serif);
    --bs-body-font-size: 0.8rem;
    --bs-body-font-weight: 200;
    --bs-body-line-height: 1.5;
    --bs-body-color: #ecf0f1;
    --bs-body-color-rgb: 236, 240, 241;
    --bs-body-bg: #1a1a1a;
    --bs-body-bg-rgb: 26, 26, 26;
    --bs-emphasis-color: #fff;
    --bs-emphasis-color-rgb: 255, 255, 255;
    --bs-secondary-color: rgba(236, 240, 241, 0.75);
    --bs-secondary-color-rgb: 236, 240, 241;
    --bs-secondary-bg: #2c3e50;
    --bs-secondary-bg-rgb: 44, 62, 80;
    --bs-tertiary-color: rgba(236, 240, 241, 0.5);
    --bs-tertiary-color-rgb: 236, 240, 241;
    --bs-tertiary-bg: #1a2631ff;
    --bs-heading-color: #ff8c42;
    --bs-link-color: #ff8c42;
    --bs-link-color-rgb: 255, 140, 66;
    --bs-link-decoration: underline;
    --bs-link-hover-color: #ffb885;
    --bs-link-hover-color-rgb: 255, 184, 133;
    --bs-code-color: #ffb347;
    --bs-highlight-color: #ecf0f1;
    --bs-highlight-bg: #4d3415;
    --bs-border-width: 1px;
    --bs-border-style: solid;
    --bs-border-color: #212e3bff;
    --bs-border-color-translucent: rgba(255, 140, 66, 0.175);
    --bs-border-radius: 0.375rem;
    --bs-border-radius-sm: 0.25rem;
    --bs-border-radius-lg: 0.5rem;
    --bs-border-radius-xl: 1rem;
    --bs-border-radius-xxl: 2rem;
    --bs-border-radius-2xl: var(--bs-border-radius-xxl);
    --bs-border-radius-pill: 50rem;
    --bs-box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.5);
    --bs-box-shadow-sm: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.3);
    --bs-box-shadow-lg: 0 1rem 3rem rgba(0, 0, 0, 0.6);
    --bs-box-shadow-inset: inset 0 1px 2px rgba(0, 0, 0, 0.3);
    --bs-focus-ring-width: 0.25rem;
    --bs-focus-ring-opacity: 0.25;
    --bs-focus-ring-color: rgba(255, 140, 66, 0.25);
    --bs-form-valid-color: #2ecc71;
    --bs-form-valid-border-color: #2ecc71;
    --bs-form-invalid-color: #e74c3c;
    --bs-form-invalid-border-color: #e74c3c;
}


.blockwelcome{
    filter: contrast(1.2);
}



#userlist > tr.someoneelse.troll {
    background-color: red !important; 
}

.mod-crown.userlistIcon{
    padding-left: 10px;
    font-size: 0.88rem;
}
.myself>.text-center{
    color: var(--bs-primary);
}
tbody#userlist > tr{
    display: block;
    margin-bottom: -1px;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
}   
tbody#userlist > tr.myself{
    margin-bottom: -2px;
    padding-top: 2px;
}

.messengerUser{
    border-bottom: 1px solid var(--bs-tertiary-bg);
}
.messengerUser.selected{
    background-color: var(--bs-tertiary-bg) !important;
}


.badge.badge-secondary{
    background-color: var(--bs-primary);
}
.navbar-brand{
    color:var(--bs-primary) !important;
}
.navbar-version{
    color: red !important;
}
.splashScreenText {
    content: 'D' !important;
    color: var(--bs-primary) !important;
    position: absolute;
    overflow: hidden;
    max-width: 7em;
    white-space: nowrap;
    transition: color 0.8s;
}

.blockwelcome:after {
    content: "FlockMoD";
    font-size: 300%;
    font-weight: 700;
    padding: 20px;
    color: var(--bs-primary);
}
.fas.cursorCenter{
    color: var(--bs-primary) !important;
} 
tr.someoneelse > td {
        font-weight: 300 !important;
        font-size: 0.74rem !important;
    }
tr.myself > td {
    font-size: 0.74rem !important;
    font-weight: 350 !important;
}

.notifyMSG_room>span.rankrankUU,
tr > td.rankUU,
.chatBlock > .msgUsername.rankUU{
    color: #bdbdbdff !important;
}
.notifyMSG_room>span.rankRU,
tr > td.rankRU,
.chatBlock > .msgUsername.rankRU{
    color: #FFF !important;
}
.notifyMSG_room>span.rankTU,
tr > td.rankTU,
.chatBlock > .msgUsername.rankTU{
    color: #ffda35ff !important;
}

.notifyMSG_room>span.rankRM,
tr > td.rankRM,
.chatBlock > .msgUsername.rankRM{
    color: #1db924ff !important;
}
.notifyMSG_room>span.rankFM,
tr > td.rankFM,
.chatBlock > .msgUsername.rankFM{
    color: #2bd3e6ff !important;
}

.notifyMSG_room>span.rankLM,
tr > td.rankLM,
.chatBlock > .msgUsername.rankLM{
    color: #3981c4ff !important;
}
.notifyMSG_room>span.rankRO,
tr > td.rankRO,
.chatBlock > .msgUsername.rankRO{
    color: #ff8725ff !important;
}
.notifyMSG_room>span.rankGM,
tr > td.rankGM,
.chatBlock > .msgUsername.rankGM{
    color: #ff20daff !important;
}


.channelTypeUser:not(.selected) {
    border-color: #e7d18f;
}
.channelTypeUser.selected {
    border-color: var(--bs-primary);
}

.regularRow.selected{
    background-color: var(--bs-tertiary-bg) !important;
}
.btn#sidebarCollapse{
    border-radius: 0;
}
.btn[name='newPM']{
    background-color: var(--bs-gray-300);
}
.btn[name='newPM']:hover{
    background-color: var(--bs-gray-700);
}
.roomDescription{
    background-color: var(--bs-tertiary-bg);
}
div[data-type='room']{
  background-color: var(--bs-tertiary-bg);
}
div[data-type='room'].selected{
    background-color: #50667d;
}
div[data-type='user']{
  background-color: var(--bs-tertiary-bg);
}
div[data-type='user'].selected{
    background-color: #50667d;
}


#sidebar{
    background-color: var(--bs-tertiary-bg);
}
/* Body and Base Styles */
body {
    /* Main content area background */
    background-color: var(--bs-gray-900); 
    color: var(--bs-body-color);
}

a, a:active, a:focus, a:link {
    color: var(--bs-link-color);
}

a:hover {
    color: var(--bs-link-hover-color);
}

h1, h2, h3, h4, h5, h6 {
    color: var(--bs-heading-color);
    padding-bottom: 4px;
}

.table {
    color: var(--bs-body-color);
}

/* Header and Navigation */
.headerBox {

    background-color: var(--bs-gray-800);
    color: var(--bs-body-color);
}

.navbar-light .navbar-brand {
    color: var(--bs-body-color);
}

.navbar-light .navbar-brand:focus, .navbar-light .navbar-brand:hover {
    color: var(--bs-body-color);
}

.topNavbar {
    border-bottom: 2px solid var(--bs-border-color);
    color: var(--bs-white);
}

.topNavbar > .container {
    background-color: var(--bs-secondary-bg);
}

.bottomNavbar {
    background-color: var(--bs-secondary-bg);
    border-top: 2px solid var(--bs-border-color);
    color: var(--bs-body-color);
}

.sidebarNavbar {
    background-color: var(--bs-secondary-bg);
    border-top: 1px solid var(--bs-border-color);
    color: var(--bs-body-color);
}

.topNavbar .navbar-nav .nav-link {
    color: var(--bs-body-color);
}

.bottomNavbar .navbar-nav .nav-link {
    color: var(--bs-body-color);
}

.sidebarNavbar .navbar-nav .nav-link:not(.disabled) {
    color: var(--bs-body-color);
}

.sidebarNavbar .navbar-nav .nav-link.disabled {
    color: var(--bs-gray-600);
}

.topNavbar .navbar-nav .nav-link:hover {
    color: var(--bs-emphasis-color);
    background-color: var(--bs-gray-700);
}

.sidebarNavbar .navbar-nav .nav-link:hover {
    color: var(--bs-link-hover-color);
    background-color: var(--bs-tertiary-bg);
}

.bottomNavbar .navbar-nav .nav-link:hover {
    color: var(--bs-link-hover-color);
    background-color: var(--bs-tertiary-bg);
}

.bottomNavbar .selected {
    background-color: var(--bs-gray);
}

.topNavbar .dropdown-menu {
    border: 1px solid var(--bs-border-color) !important;
    background-color: var(--bs-tertiary-bg) !important;
}

.topNavbar .dropdown-item {
    background-color: var(--bs-tertiary-bg) !important;
}

.topNavbar .dropdown-item:hover {
    background-color: var(--bs-gray-700) !important;
}

#topbarProgress .bar {
    background-color: var(--bs-primary);
}

.nav-separator {
    background-color: var(--bs-border-color);
}

/* Dialog Styles */
.dialogTitlebar {
    background-color: var(--bs-gray-700);
}

.dialogTitlebar.inactive {
    background-color: var(--bs-gray-800);
}

.dialog {
    /* Dialog box background */
    color: var(--bs-body-color);
    background-color: var(--bs-secondary-bg);
    border-color: var(--bs-border-color);
}

.dialogTitle {
    color: var(--bs-body-color);
}

.dialogTitle a {
    color: var(--bs-body-color);
}

.leftSide {
    background: var(--bs-tertiary-bg);
}

.dynamicDialogArea {
    background-color: var(--bs-tertiary-bg);
    color: var(--bs-body-color);
}

/* FIX: Input fields (less dark) */
.dialog .form-control {
    /* Changed from --bs-dark to the slightly less intense --bs-gray-900 */
    background-color: var(--bs-gray-400); 
    border: 1px solid var(--bs-border-color);
    color: var(--bs-body-color);
}

.dialog .form-control:focus {
    /* Changed from --bs-dark to the slightly less intense --bs-gray-900 */
    background-color: var(--bs-gray-400); 
    border: 1px solid var(--bs-primary);
    color: var(--bs-body-color);
}

.dialog > .form-control:disabled, .form-control[readonly] {
    background-color: var(--bs-gray-900);
    border: 1px solid var(--bs-border-color);
    color: var(--bs-gray);
}

/* Buttons */
.btn-danger:not(:disabled):not(.disabled),
.btn-danger:not(:disabled):not(.disabled):focus,
.btn-default:not(:disabled):not(.disabled),
.btn-default:not(:disabled):not(.disabled):focus,
.btn-info:not(:disabled):not(.disabled),
.btn-info:not(:disabled):not(.disabled):focus,
.btn-primary:not(:disabled):not(.disabled),
.btn-primary:not(:disabled):not(.disabled):focus,
.btn-success:not(:disabled):not(.disabled),
.btn-success:not(:disabled):not(.disabled):focus,
.btn-warning:not(:disabled):not(.disabled),
.btn-warning:not(:disabled):not(.disabled):focus {
    background-color: var(--bs-primary);
    border: 1px solid var(--bs-primary);
    color: var(--bs-emphasis-color);
}


.input-group.chatTextGroup > .btn-danger:not(:disabled):not(.disabled),
.input-group.chatTextGroup > .btn-danger:not(:disabled):not(.disabled):focus,
.input-group.chatTextGroup > .btn-default:not(:disabled):not(.disabled),
.input-group.chatTextGroup > .btn-default:not(:disabled):not(.disabled):focus,
.input-group.chatTextGroup > .btn-info:not(:disabled):not(.disabled),
.input-group.chatTextGroup > .btn-info:not(:disabled):not(.disabled):focus,
.input-group.chatTextGroup > .btn-primary:not(:disabled):not(.disabled),
.input-group.chatTextGroup > .btn-primary:not(:disabled):not(.disabled):focus,
.input-group.chatTextGroup > .btn-success:not(:disabled):not(.disabled),
.input-group.chatTextGroup > .btn-success:not(:disabled):not(.disabled):focus,
.input-group.chatTextGroup > .btn-warning:not(:disabled):not(.disabled),
.input-group.chatTextGroup > .btn-warning:not(:disabled):not(.disabled):focus {
    background-color: var(--bs-gray-800); 
    border: 1px solid var(--bs-gray-800); 
    color: var(--bs-emphasis-color);
}


.input-group.chatTextGroup > .btn-danger:not(:disabled):not(.disabled):hover,
.input-group.chatTextGroup > .btn-danger:not(:disabled):not(.disabled):focus:hover,
.input-group.chatTextGroup > .btn-default:not(:disabled):not(.disabled):hover,
.input-group.chatTextGroup > .btn-default:not(:disabled):not(.disabled):focus:hover,
.input-group.chatTextGroup > .btn-info:not(:disabled):not(.disabled):hover,
.input-group.chatTextGroup > .btn-info:not(:disabled):not(.disabled):focus:hover,
.input-group.chatTextGroup > .btn-primary:not(:disabled):not(.disabled):hover,
.input-group.chatTextGroup > .btn-primary:not(:disabled):not(.disabled):focus:hover,
.input-group.chatTextGroup > .btn-success:not(:disabled):not(.disabled):hover,
.input-group.chatTextGroup > .btn-success:not(:disabled):not(.disabled):focus:hover,
.input-group.chatTextGroup > .btn-warning:not(:disabled):not(.disabled):hover,
.input-group.chatTextGroup > .btn-warning:not(:disabled):not(.disabled):focus:hover {
    background-color: var(--bs-gray-400);
    border: 1px solid var(--bs-gray-400);
    color: var(--bs-emphasis-color);
}

.btn-danger.disabled,
.btn-default.disabled,
.btn-info.disabled,
.btn-primary.disabled,
.btn-secondary.disabled,
.btn-success.disabled,
.btn-warning.disabled {
    background-color: var(--bs-gray-700);
    border: 1px solid var(--bs-gray-700);
    color: var(--bs-gray);
}

.btn-danger:not(:disabled):not(.disabled):hover,
.btn-default:not(:disabled):not(.disabled):hover,
.btn-info:not(:disabled):not(.disabled):hover,
.btn-primary:not(:disabled):not(.disabled):hover,
.btn-success:not(:disabled):not(.disabled):hover,
.btn-warning:not(:disabled):not(.disabled):hover {
    background-color: var(--bs-primary-text-emphasis);
    border: 1px solid var(--bs-primary-text-emphasis);
    color: var(--bs-emphasis-color);
}

.btn-secondary:not(:disabled):not(.disabled) {
    background-color: var(--bs-secondary);
    border: 1px solid var(--bs-secondary);
    color: var(--bs-emphasis-color);
}

.btn-secondary:not(:disabled):not(.disabled):hover {
    background-color: var(--bs-secondary-text-emphasis);
    border: 1px solid var(--bs-secondary-text-emphasis);
    color: var(--bs-emphasis-color);
}

.btn-transparent {
    color: var(--bs-body-color);
}

/* Sidebar */
#sidebar {
    background-color: var(--bs-tertiary-bg);
    color: var(--bs-body-color);
    border-left-color: var(--bs-border-color) !important;
}

.containerSidebar .containerFooter {
    background-color: var(--bs-tertiary-bg);
}

.boxBgContainer .containerContent {
    background-color: var(--bs-secondary-bg);
}

.toolbar {
    background-color: var(--bs-secondary-bg);
}

/* Active Tool Color */
.selectedTool {
    /* Use gray-800 to stand out from the secondary-bg toolbar background */
    background-color: var(--bs-gray-800); 
    border-radius: 0;
}

#DrawingArea {
    background-color: var(--bs-gray-100);
}

.containerSidebar .containerTitle {
    color: var(--bs-heading-color);
}

.sidebarCollapseIcon {
    color: var(--bs-body-color);
}

/* User List */
#userlistBox {
    background-color: transparent;
    color: var(--bs-body-color);
}

/* Alternating row colors in User List */
#userlistBox td {
    background-color: transparent;
}

/* FIX: Table Stripes - Using primary-bg (lighter) and secondary-bg (darker) for clear differentiation */
#userlistBox tr:nth-child(2n) {
    background-color: var(--bs-secondary-bg); /* Darker Stripe */
}

#userlistBox tr:nth-child(odd) {
    background-color: var(--bs-primary-bg); /* Lighter Stripe */
}

#userlistBox tr.selected {
    background-color: var(--bs-gray-700) !important;
}

#userlistBox tr:hover {
    background-color: var(--bs-gray-700) !important;
}

/* Layers */
.layerPreview {
    /* Changed from gray-800 to tertiary-bg to create contrast with the sidebar */
    background-color: var(--bs-tertiary-bg);
    border-left: 4px solid transparent;
}

.layerPreview img {
    border: 1px solid var(--bs-border-color); 
}

.layerPreview:hover {
    background-color: var(--bs-gray-700);
}

.selectedLayer {
    background-color: var(--bs-primary-bg-subtle);
    border-left: 4px solid var(--bs-primary);
}

.layerPreview a {
    color: var(--bs-body-color);
}

/* Custom Controls */
.fmNumericInput.readOnly input {
    color: var(--bs-gray);
}

/* Tool buttons and controls */
.fmNumericInput.readOnly button {
    background-color: var(--bs-gray-700);
    color: var(--bs-gray);
}

.fmNumericInput:not(.readOnly) button {
    background-color: var(--bs-gray-700);
    color: var(--bs-body-color);
}

.fmNumericInput:not(.readOnly) button:hover {
    background-color: var(--bs-gray-600);
}

.fmSelector .btn {
    background-color: var(--bs-gray-700);
    color: var(--bs-body-color);
}

.fmSelector .btn.selected {
    background-color: var(--bs-primary);
}

.fmSelector .btn:not(.selected):hover {
    background-color: var(--bs-gray-600);
}

.fmSlider {
    background-color: var(--bs-gray-700);
    border-radius: 5px;
}

.fmSlider:not(.readOnly) > .fmThumb {
    background-color: var(--bs-primary);
    color: var(--bs-emphasis-color);
}

.fmSlider.readOnly > .fmThumb {
    background-color: var(--bs-gray-700);
    color: var(--bs-gray);
}

.fmSlider > .fmThumb {
    border-radius: 5px;
}

.fmSlider.readOnly > .fmSelectedArea {
    background-color: var(--bs-gray-700);
}

.fmSlider:not(.readOnly) > .fmSelectedArea {
    background-color: var(--bs-primary-border-subtle);
}

.fmSlider:not(.readOnly) > .fmThumb:hover {
    color: var(--bs-emphasis-color);
    background-color: var(--bs-primary-text-emphasis);
}

.fmButton.readOnly > a {
    background-color: var(--bs-gray);
}

.fmButton:not(.readOnly) > a {
    background-color: var(--bs-gray-700);
}

.fmButton > a {
    border-color: var(--bs-border-color);
}

.fmButton > a:hover {
    background-color: var(--bs-gray-600);
}

/* Color and Preset Bubbles */
.presetBubble {
    background-color: var(--bs-tertiary-bg);
    color: var(--bs-body-color) !important;
}

.colorBubble {
    border: 1px solid var(--bs-border-color);
    background-color: var(--bs-body-color);
}

.presetBubble:hover {
    border: 1px solid var(--bs-primary);
}

.colorBubble:hover {
    border: 1px solid var(--bs-primary);
}

/* Switch */
.fmSwitch {
    border-radius: 5px;
}

.fmSwitch:not(.readOnly) > .fmThumb {
    background-color: var(--bs-primary);
    color: var(--bs-emphasis-color);
}

.fmSwitch.readOnly > .fmThumb {
    background-color: var(--bs-gray-700);
}

.fmSwitch > .fmThumb {
    border: 0;
}

.fmSwitch:not(.readOnly) > .fmThumb:hover {
    background-color: var(--bs-primary-text-emphasis);
}

.fmSwitch .fmOn {
    background-color: var(--bs-primary-border-subtle);
}

.fmSwitch .fmOff {
    background-color: var(--bs-gray-800);
}

.fmSwitch:not(.readOnly) > .checkLabel {
    color: var(--bs-body-color);
}

.fmSwitch.readOnly > .checkLabel {
    color: var(--bs-gray);
}

/* Checkbox */
.fmCheckbox > .simpleBox {
    border-radius: 5px;
    border: 1px solid var(--bs-border-color);
}

.fmCheckbox:not(.readOnly) > .simpleBox {
    /* Changed to gray-700 for better contrast against tertiary-bg forms */
    background-color: var(--bs-gray-700);
}

.fmCheckbox.readOnly > .simpleBox {
    background-color: var(--bs-gray-900);
}

.fmCheckbox:not(.readOnly) > .fmOn {
    color: var(--bs-success);
}

.fmCheckbox:not(.readOnly) > .fmOff {
    color: var(--bs-danger);
}

/* Side Menu */
.sidemenu li a {
    color: var(--bs-body-color);
    border-bottom: 1px solid transparent;
}

.sidemenu li a:hover {
    background-color: var(--bs-gray-700);
}

.sidemenu li a.selected {
    background-color: var(--bs-primary-bg-subtle);
    color: var(--bs-primary);
}

/* Tables */
.fmTable {
    background-color: var(--bs-secondary-bg);
    color: var(--bs-body-color);
    border-collapse: collapse; 
    border: 1px solid var(--bs-border-color);
}

.fmTable td {
    background-color: transparent;
    color: var(--bs-body-color);
}

.fmTable td a {
    color: var(--bs-link-color);
}

.fmTable th {
    background-color: var(--bs-gray-900);
    color: var(--bs-emphasis-color);
    border: 1px solid var(--bs-border-color);
}

/* FIX: Table Stripes - Using primary-bg (lighter) and secondary-bg (darker) for clear differentiation */
.fmTable tr:nth-child(2n) {
    background-color: var(--bs-secondary-bg) !important; /* Darker Stripe */
}

.fmTable tr:nth-child(odd) {
    background-color: var(--bs-primary-bg) !important; /* Lighter Stripe */
}

.fmTable tr:hover {
    background-color: var(--bs-gray-700);
}

.fmTable tr.selected{
    background-color: var(--bs-tertiary-bg) !important;
}

.headerTable {
    background-color: var(--bs-tertiary-bg);
    color: var(--bs-body-color);
}


.tablePagination.selected {
    background-color: var(--bs-primary);
}

.tablePagination.selected:hover {
    background-color: var(--bs-primary-text-emphasis);
}

.tablePaginationNumber a:hover {
    background-color: var(--bs-gray-700);
}

.tablePagination {
    background-color: var(--bs-gray-700);
    color: var(--bs-body-color);
    margin-right: 2px;
}

.tablePagination:hover {
    color: var(--bs-body-color);
}

.tableContainer .dataBody {
    background-color: var(--bs-secondary-bg);
}

.tableBody {
    border: 1px solid var(--bs-border-color);
}

/* Alerts and Modals */
#alertContainer .alertMessage {
    background-color: var(--bs-secondary-bg);
    border: 3px solid var(--bs-border-color);
    border-radius: 4px;
}

#alertContainer .alertMessage .alertProgress {
    background-color: var(--bs-primary);
}

#confirmationContainer .confirmContent {
    background-color: var(--bs-secondary-bg);
    border: 3px solid var(--bs-border-color);
    border-radius: 4px;
}

.submodal .subcontent {
    background-color: var(--bs-gray-800);
    padding-top: 15px;
    opacity: 0.95;
}

/* Tooltips */
.customTooltip {
    background-color: var(--bs-gray-800);
    color: var(--bs-body-color);
}

/* Context Menu */
.context-menu-list {
    background: var(--bs-secondary-bg);
    border: 1px solid var(--bs-border-color);
}

.context-menu-item {
    background-color: var(--bs-secondary-bg) !important;
    color: var(--bs-body-color);
}

.context-menu-item:hover {
    background-color: var(--bs-gray-700) !important;
    color: var(--bs-body-color);
}

.context-menu-separator {
    border-bottom: 1px solid var(--bs-border-color);
}

/* Dropdown Menu */
.dropdown-menu {
    background: var(--bs-secondary-bg);
    border: 1px solid var(--bs-border-color);
}

.dropdown-item {
    background: var(--bs-secondary-bg);
    color: var(--bs-body-color);
}

.dropdown-item:hover {
    background: var(--bs-gray-700);
    color: var(--bs-body-color);
}

/* Scrollbars */
.os-theme-light > .os-scrollbar > .os-scrollbar-track > .os-scrollbar-handle {
    background: rgba(255, 140, 66, 1);
}

.os-theme-light > .os-scrollbar > .os-scrollbar-track > .os-scrollbar-handle:hover {
    background: rgba(255, 140, 66, 1);
}

.os-theme-light > .os-scrollbar > .os-scrollbar-track > .os-scrollbar-handle:active {
    background: rgba(255, 140, 66, 1);
}

::-webkit-scrollbar {
    background: var(--bs-body-bg);
}

::-webkit-scrollbar-thumb {
    background: rgba(255, 140, 66, 1);
    -webkit-border-radius: 1ex;
    -webkit-box-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
    cursor: grab;
}

::-webkit-scrollbar-corner {
    background: var(--bs-body-bg);
}

/* Miscellaneous */
kbd {
    background-color: var(--bs-gray-700);
    color: var(--bs-body-color);
}

fieldset {
    border-color: var(--bs-border-color);
}


.darkInput {
    /* Changed from --bs-dark to the slightly less intense --bs-gray-900 */
    background-color: var(--bs-gray-900);
    color: var(--bs-body-color);
    border-color: var(--bs-border-color);
}`
