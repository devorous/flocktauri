let drawbot;
let drawgame;
let copier;
let modsocket;
let messagehandler;
let broadcasthandler;
let actionhandler;
let trollmonitor;

let customSound;
//The sound is loaded as a base64 string at the bottom of the code
//Lazy solution to the annoyances of importing it through injection



console.log("Mods loaded...");


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
    
    receive(data){
        switch(data.type){
            case 'init':
                this.userId = data.id;
                break;
            case 'PING':
                this.send({ type: 'PONG' });
                break;
            case 'newUser':
                this.users.set(data.user.id, data.user);
                mod.modUsers = this.users;
                mod.updateUsers();
                break;
            case 'userList':
                data.users.forEach(user =>{
                    if(user.id !== this.userId){
                        this.users.set(user.id, user);
                    }
                });
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
    }
    initialize(){
        this.room = window.room;
        this.currentUsers = window.room.users;
        this.height = this.room.board.canvasHeight;
        this.width = this.room.board.canvasWidth;
    }
    updateUsers(){
        for(let [id,m] of this.modUsers){
            let u = Object.values(this.currentUsers).find(u =>
                u.username === m.name
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

        if (!trollmonitor) {
            trollmonitor = new TrollMonitor();
        }
        

        this.setupRoomOverrides();

        modsocket.send({'type': 'JOIN', 'id': modsocket.userId, 'name': this.room.myself.username, 'room': this.room.name});


        //Slight delay for some things to load
        setTimeout(()=>{
            this.updateUsers();
            trollmonitor.getUsers();
        },50);
    }
    handleRoomDisconnected() {
        console.log("Leaving room");
        trollmonitor.removeUsers();
    }
    setupInterception() {
        if (window.room) {

            
            this.connected = true;
            console.log("Console loaded");

            this.startReconnectWatcher();

            messagehandler = new MessageHandler();
            broadcasthandler = new BroadcastHandler();
            messagehandler.register('BROADCAST', broadcasthandler.handle, broadcasthandler);

            window.socket.ws.onmessage = function(message) {
                messagehandler.handle(message);
                window.socket.receive(message);
            }

            customSound = new Audio(customSoundBase64);

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

    setInterval(() => {

        const currentRoom = window.room;
        const currentSocket = window.socket;

        if (!currentRoom || !currentSocket) return;

        // The app’s internal websocket
        const ws = currentSocket.ws;


        // Websocket does NOT need reconnecting
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            reconnecting = false;
            return;
        }

        // Websocket is closing; wait until fully closed
        if (ws && ws.readyState === WebSocket.CLOSING) return;


        if (!currentRoom.name ||
            currentRoom.name === "Lobby Browser" ||
            currentRoom.loading === true ||
            (currentRoom.users && Object.keys(currentRoom.users).length === 0)) {
            return;
        }

        const now = Date.now();
        const cooldown = 10000; // 10 sec

        if (!reconnecting &&
            typeof currentSocket.connect === "function" &&
            (now - lastReconnectTime >= cooldown || lastReconnectTime === 0)) {

            reconnecting = true;
            lastReconnectTime = now;

            console.log("[Mod] WebSocket CLOSED. Attempting reconnect...");

            // Reconnect using the app's own socket system
            currentSocket.connect();

            // Reattach interception shortly after reconnect
            setTimeout(() => {
                if (window.socket && window.socket.ws) {
                    window.socket.ws.onmessage = function (message) {
                        messagehandler.handle(message);
                        window.socket.receive(message);
                    };
                }
                reconnecting = false;
            }, 600);
        }

    }, 100); // 100ms instead of 50ms—reduces false triggers even more
}

    setupGlobalOverrides(){
        const originalRecommendedSync = window.UI.recommendedSync;
        //Give users that are using the modded client priority to sync to
        window.UI.recommendedSync = function(syncList){
            setTimeout(()=>{
                syncList.sort((a, b) => {
                    const userA = window.room.users[a];
                    const userB = window.room.users[b];

                    // Check if user exists and is modded
                    const isModdedA = userA && userA.modded === true;
                    const isModdedB = userB && userB.modded === true;

                    if (isModdedA && !isModdedB) return -1; // A comes first
                    if (!isModdedA && isModdedB) return 1;  // B comes first
                    return 0; // Keep original relative order
                });
                originalRecommendedSync.call(this, syncList);
            },100);
        }
        


        const originalSetConnected = window.room.setConnected;
            window.room.setConnected = function(isConnected) {
                if (isConnected) {
                    mod.handleRoomConnected();
                } else {
                    mod.handleRoomDisconnected();
                }
                // Execute original function
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
}

let mod = new ModHandler();


mod.setupInterception();


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


class TrollMonitor{
    constructor(){
        this.users = new Map();
        this.pollingInterval = null;
        this.pollingFrequency = 40; //ms

        this.GRIEF_SPEED_THRESHOLD = 3000; // pixels per second
        this.SAFE_SPEED_THRESHOLD = 2000;
        this.IDLE_TIMEOUT = 10000;      

        // Logging setup
        this.logs = [];
        this.loggingInterval = null;
        this.logFrequency = 50; // Log every 50ms
        this.saveInterval = null;
        this.saveFrequency = 50000; // Save every 60 seconds (1 minute)
           

        messagehandler.register('JOINED', this.handleJoin, this);
        messagehandler.register('LEFT', this.handleLeft, this);
        broadcasthandler.register('Pd', this.handlePenDown, this);
        broadcasthandler.register('Pu', this.handlePenUp, this);
        broadcasthandler.register('Bch', this.handleBrushChange, this);
    }

    handleJoin(message){
        setTimeout(()=>{
            const user = room.users[message.username];
            this.addUser(user);
        }, 200)
        
    }
    handleLeft(message){
        setTimeout(()=>{
            this.removeUser(message.username);
        }, 200)
        
    }
    handlePenUp(message){
        let username = message.from;
        if(this.users.has(username)){
            this.users.get(username).penDown = false;
        }
    }
    handlePenDown(message){
        let username = message.from;
        if(this.users.has(username)){
            this.users.get(username).penDown = true;
        }
    }
    handleBrushChange(message){
        let username = message.from;
        let tool = message.brush;
        if(this.users.has(username)){
            this.users.get(username).tool = tool;
        }
    }
    addUser(user){
        let username = user.username;
        if(!this.users.has(username)){
            this.users.set(username, {
                isRanked: (user.rank != 'UU' && user.rank != 'RU'),
                penDown: false,
                averageSpeed: 0,
                currentSpeed: 0,
                trollPotential: 0,
                tool: user.surface.brushHandler.currentBrush,
                size: user.surface.brushHandler.brush.options.size.value,
                joinTime: Date.now(),
                timeInRoom: 0,
                lastUpdate: Date.now(),
                lastPosition: null,
                speedSamples: []
            });
        }
    }

    removeUser(username){
        this.users.delete(username);
    }

    getUsers(){
        let users = Object.values(window.room.users);
        for(let i=0; i< users.length; i++){
             this.addUser(users[i]);
        }
        this.startPolling();
        // this.startLogging(); // Start logging when monitoring begins
    }
    
    removeUsers(){
        this.users = new Map();
        this.stopPolling();
        this.stopLogging(); // Stop logging when monitoring ends
    }
    
    updateTool(username, tool, size){
        const user = this.users.get(username);
        if (user) {
            user.tool = tool;
            user.size = size;
            this.calculate(user);
        }
    }

    updatePosition(username, x, y){
        const user = this.users.get(username);
        if(!user) return;
        
        const currentTime = Date.now();
        
        // Calculate speed if we have a previous position
        if(user.lastPosition){
            const dx = x - user.lastPosition.x;
            const dy = y - user.lastPosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const timeDiff = (currentTime - user.lastPosition.time) / 1000; // Convert to seconds
            
            // Only calculate speed if time has passed and there's movement
            if(timeDiff > 0){
                const speed = distance / timeDiff; // pixels per second
                user.speedSamples.push(speed);
                
                // Keep only last 20 speed samples
                if(user.speedSamples.length > 20){
                    user.speedSamples.shift();
                }
                
                // Calculate average speed (average of all stored samples)
                if(user.speedSamples.length > 0){
                    const totalSpeed = user.speedSamples.reduce((sum, s) => sum + s, 0);
                    user.averageSpeed = totalSpeed / user.speedSamples.length;
                }
                
                // Calculate current speed (average of last 3 samples)
                if(user.speedSamples.length >= 2){
                    const recentCount = Math.min(3, user.speedSamples.length);
                    const recentSpeeds = user.speedSamples.slice(-recentCount);
                    const recentTotal = recentSpeeds.reduce((sum, s) => sum + s, 0);
                    user.currentSpeed = recentTotal / recentCount;
                } else if(user.speedSamples.length === 1){
                    // If we only have one sample, use it as current speed
                    user.currentSpeed = user.speedSamples[0];
                }
            }
        } 
        
        // Update last position and timestamp
        user.lastPosition = {x: x, y: y, time: currentTime};
        user.lastUpdate = currentTime;
        
        // Recalculate troll potential with updated speeds
        this.calculate(username);
    }

    calculate(username){
        const user = this.users.get(username);
        if (!user) return;
        let userObj = Object.values(room.users).find(u => u.username === username);

        
        if(user.penDown && user.averageSpeed > this.GRIEF_SPEED_THRESHOLD && (user.tool != "selection") && (!user.isRanked)){
            //Troll threshhold
            console.log("TROLL DETECTED: ", username);
            userObj.troll = true;
            customSound.play();
            let usertr = $(`tr[name='${username}']`);
            usertr.addClass('troll');
        }
        if(!user.slowStartTime){
                user.slowStartTime = Date.now();
        }
        if(user.averageSpeed < this.SAFE_SPEED_THRESHOLD){
            let slowTime = Date.now() - user.slowStartTime;
            if(slowTime >= this.IDLE_TIMEOUT ){
                let usertr = $(`tr[name='${username}']`);
                usertr.removeClass('troll');
                userObj.troll = false;
            }
        }

        let potential = 0;

        // Calculate time in room (in seconds)
        const timeInRoomSeconds = (Date.now() - user.joinTime) / 1000;
        const fiveMinutes = 300; // seconds

        // Most suspicious when they first join
        if (timeInRoomSeconds < fiveMinutes) {
            const newUserScore = 50 * (1 - (timeInRoomSeconds / fiveMinutes));
            potential += newUserScore;
        }


        // Speed is the most important behavioral indicator
        if (user.speedSamples.length >= 10) {
            let speedScore = 0;
            
            if (user.averageSpeed > 2000) {
                speedScore += 40;
            } else if (user.averageSpeed > 1000) {
                speedScore += 20;
            } else if (user.averageSpeed > 500) {
                speedScore += 15;
            }
            
            // Current speed significantly higher than average
            const speedRatio = user.currentSpeed / Math.max(user.averageSpeed, 1);
            if (speedRatio > 3) {
                speedScore += 15;
            } else if (speedRatio > 2) {
                speedScore += 10;
            } else if (speedRatio > 1.5) {
                speedScore += 5;
            }
            
            potential += speedScore;
        }
        
        let toolScore = 0;
        
        // Large brush size while drawing
        if (user.penDown && user.size > 20) {
            toolScore += 20;
        } else if (user.penDown && user.size > 10) {
            toolScore += 10;
        } else if (user.size > 20) {
            toolScore += 10;
        } else if (user.size > 10) {
            toolScore += 5;
        }
        
        // Eraser usage
        if (user.tool === 'eraser') {
            toolScore += 10;
        }
        
        potential += toolScore;

        // Pen down while moving fast is suspicious
        if (user.penDown && user.speedSamples.length >= 10) {
            if (user.currentSpeed > 2000) {
                potential += 20;
            } else if (user.currentSpeed > 1000) {
                potential += 15;
            }
        }
        
        user.trollPotential = Math.round(potential);
    }

    // Helper method for variance calculation
    calculateVariance(samples) {
        if (samples.length === 0) return 0;
        
        const mean = samples.reduce((sum, val) => sum + val, 0) / samples.length;
        const squaredDiffs = samples.map(val => Math.pow(val - mean, 2));
        const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / samples.length;
        
        return variance;
    }

    getUser(username){
        return this.users.get(username);
    }

    getSorted(){
        return Array.from(this.users.entries())
            .sort((a,b) => b[1].trollPotential - a[1].trollPotential);
    }

    startPolling(){
        if(this.pollingInterval) return; // Already running
        
        this.pollingInterval = setInterval(() => {
            this.pollAllPositions();
        }, this.pollingFrequency);
    }
    
    stopPolling(){
        if(this.pollingInterval){
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }
    
    pollAllPositions(){
        for(let [username, userData] of this.users){
            const user = window.room.users[username];
            
            if(user && user.surface){
                let x = user.surface.cursor.x;
                let y = user.surface.cursor.y;
                if (!x || !y ){
                    x = 0;
                    y = 0;
                }
                this.updatePosition(username, x, y);
            }
        }
    }
    
    // ========== LOGGING FUNCTIONS ==========
    
    startLogging(){
        if(this.loggingInterval) return; // Already running
        
        // Log data at specified frequency
        this.loggingInterval = setInterval(() => {
            this.captureSnapshot();
        }, this.logFrequency);
        
        // Save logs to file at specified frequency
        this.saveInterval = setInterval(() => {
            this.saveLogsToFile();
        }, this.saveFrequency);
        
        console.log('Logging started: capturing every', this.logFrequency, 'ms, saving every', this.saveFrequency / 1000, 'seconds');
    }
    
    stopLogging(){
        if(this.loggingInterval){
            clearInterval(this.loggingInterval);
            this.loggingInterval = null;
            console.log('Logging stopped');
        }
        if(this.saveInterval){
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }
        
        // Save any remaining logs before stopping
        if(this.logs.length > 0){
            this.saveLogsToFile();
        }
    }
    
    captureSnapshot(){
        const timestamp = Date.now();
        const snapshot = {
            timestamp: timestamp,
            timestampISO: new Date(timestamp).toISOString(),
            users: {}
        };
        
        for(let [username, userData] of this.users){
            snapshot.users[username] = {
                currentSpeed: userData.currentSpeed,
                averageSpeed: userData.averageSpeed,
                trollPotential: userData.trollPotential,
                tool: userData.tool,
                size: userData.size,
                penDown: userData.penDown, 
                position: userData.lastPosition ? {
                    x: userData.lastPosition.x,
                    y: userData.lastPosition.y
                } : null,
                speedSampleCount: userData.speedSamples.length,
                isRanked: userData.isRanked
            };
        }
        
        this.logs.push(snapshot);
    }
    
    saveLogsToFile(){
        if(this.logs.length === 0){
            console.log('No logs to save');
            return;
        }
        
        const logData = {
            sessionStart: this.logs[0].timestamp,
            sessionEnd: this.logs[this.logs.length - 1].timestamp,
            totalSnapshots: this.logs.length,
            captureFrequency: this.logFrequency,
            data: this.logs
        };
        
        const jsonString = JSON.stringify(logData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `troll-monitor-log-${timestamp}.json`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log(`Saved ${this.logs.length} snapshots to ${filename}`);
        
        // Clear logs after saving
        this.logs = [];
    }
    
    // Manual save function
    saveLogsNow(){
        this.saveLogsToFile();
    }
    
    // Get current log stats
    getLogStats(){
        return {
            totalSnapshots: this.logs.length,
            memoryUsageApprox: JSON.stringify(this.logs).length / 1024, // KB
            oldestSnapshot: this.logs.length > 0 ? new Date(this.logs[0].timestamp).toISOString() : null,
            newestSnapshot: this.logs.length > 0 ? new Date(this.logs[this.logs.length - 1].timestamp).toISOString() : null
        };
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

#userlist>tr.someoneelse.troll{
    color: red !important;
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
tr > td.rankFM{
    color: #2bd3e6ff !important;
}
tr > td.rankRM{
    color: #1db924ff !important;
}
tr > td.rankRO{
    color: #ff8725ff !important;
}
tr > td.rankLM{
    color: #3981c4ff; !important;
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
.roomDescription{
    background-color: var(--bs-tertiary-bg);
}
div[data-type='room']{
  background-color: var(--bs-tertiary-bg);
}
div[data-type='room'].selected{
    background-color: var(--bs-primary);
}
div[data-type='user']{
  background-color: var(--bs-tertiary-bg);
}
div[data-type='user'].selected{
    background-color: var(--bs-primary);
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
    /* Retain secondary-bg for the top header bar, which is darker than the body background */
    background-color: var(--bs-secondary-bg);
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
    background-color: var(--bs-gray-700);
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

let customSoundBase64 = `data:audio/mpeg;base64,SUQzAwAAAABHS1RZRVIAAAAGAAAAMjAyNQBUREFUAAAABgAAADA0MDIAVElNRQAAAAYAAAAwOTEz
AFBSSVYAABuRAABYTVAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6
TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0i
QWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0MzYwLCAyMDIwLzAyLzEzLTAxOjA3OjIyICAg
ICAgICAiPgogPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIy
LXJkZi1zeW50YXgtbnMjIj4KICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgeG1s
bnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iCiAgICB4bWxuczpzdEV2
dD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlRXZlbnQjIgogICAg
eG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJl
ZiMiCiAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iCiAgICB4bWxu
czp4bXBETT0iaHR0cDovL25zLmFkb2JlLmNvbS94bXAvMS4wL0R5bmFtaWNNZWRpYS8iCiAgICB4
bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgIHhtbG5zOmNyZWF0
b3JBdG9tPSJodHRwOi8vbnMuYWRvYmUuY29tL2NyZWF0b3JBdG9tLzEuMC8iCiAgICB4bWxuczpk
Yz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iCiAgIHhtcE1NOkluc3RhbmNlSUQ9
InhtcC5paWQ6NGM4YWQ1YzQtYTk1ZC04NTQ1LTgxYzItNTJjNGQ2ZTI3YmZiIgogICB4bXBNTTpE
b2N1bWVudElEPSI0YTNkZTg1Yi1mODEwLThkNTMtM2IyYy00ZGMyMDAwMDAwNTUiCiAgIHhtcE1N
Ok9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDo5NmZjYmQ2MC0zMDc4LWM5NDgtODIyNi1hMzZk
NzAzNjBiY2QiCiAgIHhtcDpNZXRhZGF0YURhdGU9IjIwMjUtMDItMDRUMDk6MTQ6MDMtMDU6MDAi
CiAgIHhtcDpNb2RpZnlEYXRlPSIyMDI1LTAyLTA0VDA5OjE0OjAzLTA1OjAwIgogICB4bXA6Q3Jl
YXRvclRvb2w9IkFkb2JlIFByZW1pZXJlIFBybyAyMDIwLjAgKFdpbmRvd3MpIgogICB4bXA6Q3Jl
YXRlRGF0ZT0iMjAyNS0wMi0wNFQwOToxMzozMi0wNTowMCIKICAgeG1wRE06YXVkaW9TYW1wbGVS
YXRlPSItMSIKICAgeG1wRE06YXVkaW9TYW1wbGVUeXBlPSIxNkludCIKICAgeG1wRE06YXVkaW9D
aGFubmVsVHlwZT0iU3RlcmVvIgogICB4bXBETTpzdGFydFRpbWVTY2FsZT0iMzAwMDAiCiAgIHht
cERNOnN0YXJ0VGltZVNhbXBsZVNpemU9IjEwMDEiCiAgIGRjOmZvcm1hdD0iTVAzIj4KICAgPHht
cE1NOkhpc3Rvcnk+CiAgICA8cmRmOlNlcT4KICAgICA8cmRmOmxpCiAgICAgIHN0RXZ0OmFjdGlv
bj0ic2F2ZWQiCiAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9IjZiMDBiZTVhLTkxM2MtNWE1NC01ZWMw
LTFkMWQwMDAwMDA4MiIKICAgICAgc3RFdnQ6d2hlbj0iMjAyNS0wMi0wNFQwOToxNDowMy0wNTow
MCIKICAgICAgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUHJlbWllcmUgUHJvIDIwMjAuMCAo
V2luZG93cykiCiAgICAgIHN0RXZ0OmNoYW5nZWQ9Ii8iLz4KICAgICA8cmRmOmxpCiAgICAgIHN0
RXZ0OmFjdGlvbj0iY3JlYXRlZCIKICAgICAgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDphNGVm
MDc3Ny0wZDZhLWYzNDEtOGMwOS1jNTEyODYwY2NmMTkiCiAgICAgIHN0RXZ0OndoZW49IjIwMjUt
MDItMDRUMDk6MTQ6MDItMDU6MDAiCiAgICAgIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBy
ZW1pZXJlIFBybyAyMDIwLjAgKFdpbmRvd3MpIi8+CiAgICAgPHJkZjpsaQogICAgICBzdEV2dDph
Y3Rpb249InNhdmVkIgogICAgICBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOjYwMDRhNGFiLTM0
ZTktODE0Ni05M2UyLWYyNjkxNDljMTRhYyIKICAgICAgc3RFdnQ6d2hlbj0iMjAyNS0wMi0wNFQw
OToxNDowMy0wNTowMCIKICAgICAgc3RFdnQ6c29mdHdhcmVBZ2VudD0iQWRvYmUgUHJlbWllcmUg
UHJvIDIwMjAuMCAoV2luZG93cykiCiAgICAgIHN0RXZ0OmNoYW5nZWQ9Ii8iLz4KICAgICA8cmRm
OmxpCiAgICAgIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiCiAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9Inht
cC5paWQ6NGM4YWQ1YzQtYTk1ZC04NTQ1LTgxYzItNTJjNGQ2ZTI3YmZiIgogICAgICBzdEV2dDp3
aGVuPSIyMDI1LTAyLTA0VDA5OjE0OjAzLTA1OjAwIgogICAgICBzdEV2dDpzb2Z0d2FyZUFnZW50
PSJBZG9iZSBQcmVtaWVyZSBQcm8gMjAyMC4wIChXaW5kb3dzKSIKICAgICAgc3RFdnQ6Y2hhbmdl
ZD0iL21ldGFkYXRhIi8+CiAgICA8L3JkZjpTZXE+CiAgIDwveG1wTU06SGlzdG9yeT4KICAgPHht
cE1NOkluZ3JlZGllbnRzPgogICAgPHJkZjpCYWc+CiAgICAgPHJkZjpsaQogICAgICBzdFJlZjpp
bnN0YW5jZUlEPSJkOWEzODg5Yy0yNDdkLTM1ODEtODJjMy0zMjJkMDAwMDAwOTQiCiAgICAgIHN0
UmVmOmRvY3VtZW50SUQ9ImFlNDk1YmFkLTQ2NDEtNjg0Mi1iM2VmLTJlMmYwMDAwMDA2NyIKICAg
ICAgc3RSZWY6ZnJvbVBhcnQ9InRpbWU6Mjc4MTQ0NzM4NTI0OGYyNTQwMTYwMDAwMDBkMzAwNTgy
NTk0MTQ0ZjI1NDAxNjAwMDAwMCIKICAgICAgc3RSZWY6dG9QYXJ0PSJ0aW1lOjBkMzAwNTgyNTk0
MTQ0ZjI1NDAxNjAwMDAwMCIKICAgICAgc3RSZWY6ZmlsZVBhdGg9InVua25vd25fMjAyNS4wMi4w
NC0wOS4wOF8xLm1wNCIKICAgICAgc3RSZWY6bWFza01hcmtlcnM9Ik5vbmUiLz4KICAgICA8cmRm
OmxpCiAgICAgIHN0UmVmOmluc3RhbmNlSUQ9ImQ5YTM4ODljLTI0N2QtMzU4MS04MmMzLTMyMmQw
MDAwMDA5NCIKICAgICAgc3RSZWY6ZG9jdW1lbnRJRD0iYWU0OTViYWQtNDY0MS02ODQyLWIzZWYt
MmUyZjAwMDAwMDY3IgogICAgICBzdFJlZjpmcm9tUGFydD0idGltZToyNzgxNDQ3Mzg1MjQ4ZjI1
NDAxNjAwMDAwMGQzMDA1ODI1OTQxNDRmMjU0MDE2MDAwMDAwIgogICAgICBzdFJlZjp0b1BhcnQ9
InRpbWU6MGQzMDA1ODI1OTQxNDRmMjU0MDE2MDAwMDAwIgogICAgICBzdFJlZjpmaWxlUGF0aD0i
dW5rbm93bl8yMDI1LjAyLjA0LTA5LjA4XzEubXA0IgogICAgICBzdFJlZjptYXNrTWFya2Vycz0i
Tm9uZSIvPgogICAgPC9yZGY6QmFnPgogICA8L3htcE1NOkluZ3JlZGllbnRzPgogICA8eG1wTU06
UGFudHJ5PgogICAgPHJkZjpCYWc+CiAgICAgPHJkZjpsaT4KICAgICAgPHJkZjpEZXNjcmlwdGlv
bgogICAgICAgeG1wOkNyZWF0ZURhdGU9IjE5MDQtMDEtMDFUMDA6MDBaIgogICAgICAgeG1wOk1v
ZGlmeURhdGU9IjIwMjUtMDItMDRUMDk6MTE6MjgtMDU6MDAiCiAgICAgICB4bXA6TWV0YWRhdGFE
YXRlPSIyMDI1LTAyLTA0VDA5OjExOjI4LTA1OjAwIgogICAgICAgdGlmZjpPcmllbnRhdGlvbj0i
MSIKICAgICAgIHhtcE1NOkluc3RhbmNlSUQ9ImQ5YTM4ODljLTI0N2QtMzU4MS04MmMzLTMyMmQw
MDAwMDA5NCIKICAgICAgIHhtcE1NOkRvY3VtZW50SUQ9ImFlNDk1YmFkLTQ2NDEtNjg0Mi1iM2Vm
LTJlMmYwMDAwMDA2NyIKICAgICAgIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpj
M2FiY2JkNC03NGRlLTlkNDItOTQzOC01YzdhYTg3YmFjMWYiPgogICAgICA8eG1wRE06ZHVyYXRp
b24KICAgICAgIHhtcERNOnZhbHVlPSIxNDU0NSIKICAgICAgIHhtcERNOnNjYWxlPSIxLzEwMDAi
Lz4KICAgICAgPHhtcE1NOkhpc3Rvcnk+CiAgICAgICA8cmRmOlNlcT4KICAgICAgICA8cmRmOmxp
CiAgICAgICAgIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiCiAgICAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9
ImQ5YTM4ODljLTI0N2QtMzU4MS04MmMzLTMyMmQwMDAwMDA5NCIKICAgICAgICAgc3RFdnQ6d2hl
bj0iMjAyNS0wMi0wNFQwOToxMToyOC0wNTowMCIKICAgICAgICAgc3RFdnQ6c29mdHdhcmVBZ2Vu
dD0iQWRvYmUgUHJlbWllcmUgUHJvIDIwMjAuMCAoV2luZG93cykiCiAgICAgICAgIHN0RXZ0OmNo
YW5nZWQ9Ii8iLz4KICAgICAgIDwvcmRmOlNlcT4KICAgICAgPC94bXBNTTpIaXN0b3J5PgogICAg
ICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgICA8L3JkZjpsaT4KICAgIDwvcmRmOkJhZz4KICAgPC94
bXBNTTpQYW50cnk+CiAgIDx4bXBNTTpEZXJpdmVkRnJvbQogICAgc3RSZWY6aW5zdGFuY2VJRD0i
eG1wLmlpZDphNGVmMDc3Ny0wZDZhLWYzNDEtOGMwOS1jNTEyODYwY2NmMTkiCiAgICBzdFJlZjpk
b2N1bWVudElEPSJ4bXAuZGlkOmE0ZWYwNzc3LTBkNmEtZjM0MS04YzA5LWM1MTI4NjBjY2YxOSIK
ICAgIHN0UmVmOm9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDphNGVmMDc3Ny0wZDZhLWYzNDEt
OGMwOS1jNTEyODYwY2NmMTkiLz4KICAgPGNyZWF0b3JBdG9tOndpbmRvd3NBdG9tCiAgICBjcmVh
dG9yQXRvbTpleHRlbnNpb249Ii5wcnByb2oiCiAgICBjcmVhdG9yQXRvbTppbnZvY2F0aW9uRmxh
Z3M9Ii9MIgogICAgY3JlYXRvckF0b206dW5jUHJvamVjdFBhdGg9IlxcP1xDOlxVc2Vyc1xSb21h
XERvY3VtZW50c1xBZG9iZVxQcmVtaWVyZSBQcm9cMTQuMFxTcG90dGVkIFNGWCBXb3JsZCBPZiBU
YW5rcy5wcnByb2oiLz4KICAgPGNyZWF0b3JBdG9tOm1hY0F0b20KICAgIGNyZWF0b3JBdG9tOmFw
cGxpY2F0aW9uQ29kZT0iMTM0NzQ0OTQ1NSIKICAgIGNyZWF0b3JBdG9tOmludm9jYXRpb25BcHBs
ZUV2ZW50PSIxMTI5NDY4MDE4Ii8+CiAgIDx4bXBETTpwcm9qZWN0UmVmCiAgICB4bXBETTp0eXBl
PSJtb3ZpZSIvPgogICA8eG1wRE06ZHVyYXRpb24KICAgIHhtcERNOnZhbHVlPSIzNSIKICAgIHht
cERNOnNjYWxlPSIxMDAxLzMwMDAwIi8+CiAgIDx4bXBETTpzdGFydFRpbWVjb2RlCiAgICB4bXBE
TTp0aW1lRm9ybWF0PSIyOTk3RHJvcFRpbWVjb2RlIgogICAgeG1wRE06dGltZVZhbHVlPSIwMDsw
MDswMDswMCIvPgogICA8eG1wRE06YWx0VGltZWNvZGUKICAgIHhtcERNOnRpbWVWYWx1ZT0iMDA7
MDA7MDA7MDAiCiAgICB4bXBETTp0aW1lRm9ybWF0PSIyOTk3RHJvcFRpbWVjb2RlIi8+CiAgPC9y
ZGY6RGVzY3JpcHRpb24+CiA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgogICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
IAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAog
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg
ICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgCjw/eHBhY2tldCBlbmQ9InciPz4A
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/++RA
AAAP/ABLgAAACZyACXAAAAEAAAEuAAAAIAAAJcAAAAT/////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////++RAAAAP/ABLgAAA
CY0ACXAAAAEBLAEagAAAIBcAY1AAAAT/////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////RJQBQCTNIA6TQIBABA/0j/++RAAAAK+EFF47p64LZoKLx3L1wY
ZYM7TXGN8wyuZ3WeMbZuWNJJ/1KBi+CRj0JhiCQ4GKMwlJczpOkxTZQ7myw3CLYRBoYLimYlhmZk
WgnMiJfAEhV5JuOSKiTYwxaenCv5Xqr1xJcNDSIaXDbfLFMaJSVeYvuq9LdTlTtX58iAFUEEKgAM
Harx61IpEWulKplKplCokshCIOBzQhXpxjXbYp10wqZYRCyyu3FVzKOIr2Bsb4C7XnsKLGjRZ5n9
I+rw8S4riW1ZratWPS9KXgZFQZBoyZcK6q13oMwGtSqaEZf/////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////////9uWNJJ/1KBiOAxiwGBhiNJiOCJhWPJmOa5iyuh1hdBs0VA
XCYwREsxHC80xy65lh0BcNoywEMio529j4atLQl+qfY8rxv1iOG+7rLCmWKna8yN6/002LtHXue4
6DMDkKAAeIlDy5qRcKduXLc2qZWqpaUCkOCdUM6sb2OAp2p63OCkWWV3Fc5meIr2CRjkb16LCi2n
izzR6R9Xh4viuM2rq2t1j6vSl4GQqKg0ZMmQH22dzq+6QRylf8aSRJWbMGZMifZU4FaHBjqcQMBk
6A58H6cZdTDmXMtTlZ6ZAGCw09cqVZx/4ugUYWCgsDTGS+CMibzrJyheESdU5eV0JDEIOuQ/asdm
l6y+5Ywr28udzz/QPGNTxDxxYO8d0EqCAXKiQI65RDccyevLfSYAg6ZhwMH7CQo5tUOBYSX+Thlf
sFCWJZmv8kGDjC+Bxw4r8581JZPeJANBEEc/w4clt/73Yif279Pu+vmWFjk4sc3+ys39hzV95278
/oiJCUbcaaRJUWWAZ86T/InmHUffaoIUaoJfqCIs8wkAkfkDmgqAt1MdC5fVvVS7OQ3PocDCQOJg
KYsVQCtJuGcnDFUTIhvnVrUtSd1L7XOzS/beSyU5+05i87SFsHigoLDLCxxXBUtDgJCEysXxna+h
XP6RywsOL+BQPKRrIfcQhAJhw2vfSRHb5weGZLMzNWVBALGH9toshX5SW9Xr2CQJAiCOfvwLJbuv
cpSEzv80lt/DxxhYs/FlTM/n9vfGOLn7/0D/++RAAAAMZWBS+zljaKnsCl9nLG0XRYFJ7GHtgq0w
KTT8MbKYMCRVVFJm2tuxYFKFfQa1yCxstX9PYkkzZilW/OVqKcSalt/n9vS21rPF92AncUlrTXsu
b7zLD6fe3/tXzwzO1zUOLGufZBoDQ0GJkTQrdKw0iMdjMiBGvEAvKDAzJiR+pEIBYeLKwZBykOvR
FeFW+VS28XWsNbISyq15WfnytDXr2IInNi8/OGlHHK54+Wew+fPXrqctp2IGcx1+7jFMtSzbeXR6
29NOnrMc5P2923//////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///9OgkiqqKTdtbdAaw0BMGeFqDdxvNt6f49Mzsmxr2LWM4kFFc+fuzZy1ni6bIToGUNpr3f/vKb
Dcv3m1+1cOH200ENlEEb/joJBYIheJpP06IJOXn5oFasSOWpF54hfCalJF6hwoklYm1Qd7R9DfO2
2mj1kpOQqGF686elmhxaq5ln5PLOrjk+yNi7T7yuM9jWr4bQOy1Fe8U0tfpbX0uj3Xpp05bbsV+3
xWliEjRERQJtt/4BajDzGYiz4ZOaSQXNslfKNYV6TGW0koroJeTlu3Zj9Pzf/Zf0/qVi5/85j/aS
h38/EO1WJPNz5vrAVarW2VRqJftd4xqpMr2nBrhVROXJSSsjIoTjbneYjE4oicfKmVLx1KxMqewi
YDau0lHZYCThKyqEoSy4WXlo0F43OWnqkZG5fgsDCzp97ir2M1xKOL+VxtKx6huUa9qala7sL1hv
nbzNbP4tauvGiz6lvFnaP12oFJJIBNtuR+PF4IuYYwgQ4AuTvGaVsLcOtuTVJRstznLM88bf7/fz
MVPaFYse//Mf3SVc+S+Iaqnx8mPl8VCWvP0SMtIcZ+7cfk5e44SsQifsnF0Cq0P2H/YTLSkjAqZK
ViiNM6XqCnEMrkKFTg9wHlTVlzOQnJ5xi+3QljCe6xbkLrSI5VM9HEdvlh66+rNjNuOkltt9DWnN
9uYay0fqFtUDY++YbuvFD9b/++RAAAAL0mBTezl7aK+sCl9nL2wVyYFL7OGNow4wKb2MvbSJUSNV
VFButlukrKo4phOuOtEJMkFiHKXl7+Xe4Y6SW19b6feXM9fQMbMKtVk7lrLHe7NBKtU81AdDdgV7
bHrFTMWrlB3VuhNzk2N7E05cILBRxtHaWO2tPtNjm3yMDOPieSLHzR85WjOU0rHas0KNZW6c6Xi1
ap7M9HGCs5n9swISne6ixK1lYZo165xCw24g3kzCvnOLwsvaYvnVomoMlPjGfjPsx/q/////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////eFAjRFNSbtt/3paU3Z8IFYm7omI9tR9K9
ikz5Qz9JO1k3st1vp6G/Lc9fEF9mJ6oRe7rLHe7Nya5L7kB26tIuZX81UnBvDb53rdCanJWN8Jaf
sj1kYGViZ0uxvsvW6ki3DkYGcfHo6c3UD73HUTjFY4V9RmaitkZ1mO6lUltw6MsdZzH1Ha2zt8GM
9dSxZ4NNx4ntJpSyPdwNtz/cuKwsvaT/OLUrBkp8YvLCz7P/1VaiRqzIwN11t65mbMoU3dBpZVGO
ANmkQc6RzWUrrU8SynplN/trdNTZybL/+NrpMeFc6x/n49hnOrLbEFuNf0eD/EkbgZSqEMlKVqgt
lp+6AlW3P1LpmYP3Mk1jmFXZxPAfDikOgFARPLsoLY9XhHr7IR86tcOeJzKRKpeuiXK2XmFyqqvn
72OoSqp9u1nMOTVYq/oIoOTLn7OWXM9ZbEd8qddv9f+2R930x2u8P02ombMysXdtduw5py3Xbep4
ywY3Bhykc6T4ZzOqeaqW9ioPZ7KmlXZBb/uEXU1BvSXs1Z+r2ltRHdWK4QHD1/2RC3sCG8VqliLt
XOKlVCFmU15K1fe1Q9WKk42BbhQnkJ7DdtzYuWpVHKpG5Di2qCM2pt+d0d+SpycoEbD1kL6oTqqi
Hqy5NqhZltWuTUxKu6Xq50qilKYKpjP3yueUP1AsiWly3OLZRehM9nTctPaRoOmOrkrWV/W/3PZy
pEc8Wi+HpVD/++RAAAALRV7S+xhjaq2L2l9jDG1ZNYFLrWXtsvCvKXWsPbfKYRNWZWTn2u3XMy1f
TBW6SYqyCP9+B5FDtu3PZffpLRbR7pRlct0FffN4uym4bCyHdq9r+/dwu/vBqGF9uq3z5UWZaouF
B5A9AulOvNThOgwHTr7p4lQYlfp4SwNZucHjLKE4hOUMz08fPzhvTx9lpQ8U2YhOsXUjadgyhUmj
RYMmqLIbYsOKQUfe1W3H/XvayHZDbjjXuRPuWfrLnMxzRu/bBSGrFdjTf///////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///////+64kjMysXdtbuxJkK+IYYc/g6gXvA11+4tKbde/ljf+XA4EDRi1NV8r93m8YBZ4S3XVLb
WP7rdr4ynmOLFKkuXwmNTJ9TkHF4UHC5U09hVMyaVCufWEpE+6ULDPveK61wH47EgzbSQnUCQSz1
w/fPEtDV2tkBeVTFYdIRi1VOaH01UQKV1rQM88YMQLq88+2lenn+yM5/W/Pi65WNQ89eJAcZerVm
7uwMVZSVmOFYynJHCnG03IPbItOAV9IEF1j65ccGrFZlW7FcKCSS75aEDPL+Ea+tPzuX1oCcAfCD
AIt/abn7qbs8ll0v3ayfTI07U1HdMizZgMM4DyP1o0c6gjpZILbLFcy9F+WXCsRX4Vqcexla1vns
A+EIZ4ezmQpUtlmddRmV6qkSpYBCkOkTz5OI4oTlmjIktpebvIKbQ92yHazp1WHAwRFy8WnNjVat
cDwjvFY1OM867ZXtFaqVQrnbkzXfHVHeo1XXgwVvEW718zYgNk7u1lOSOEuNptxdniDbOWlJSICw
8Up+Op0vpI7MR7clV+tSA5z5ZYZX927H87KHYViSwtd/L/+znjlqujnfuKphTSnVD955sMBzoQlk
S6uu2SG5KRbcPYridKmLuLDeRUUvsz27NH7YqJ7xjSVSpYrK9MOlbVXNqdgC3KI0U8ujeJ0d7DaM
iTpiM8FyZ1G+VClV6G0WGWTLg5wbqpWsCgc9skjUxM0dDU6xQ2WI+cp42NRvXUbeYN9anzaNuy7/
++RAAAAKhV1RaxnDbrxLah1jGG3X9YFFrOHtsz0wKLWcPbaxhKSNpKNpJ5s8Q0NhHbZmK3GVIot0
KAKgjbZS4cblTgM7WsyAyH3Lv2OYV8tdrV1US6VcDkvJfxt8yvaxy1qOqUc1ampBLZbOzU/UvTIw
V/YZfWfll/GC4i5VPOzObJpXDUNT81yK9tUVLK7GUPZUNL2ct18p75ulh2pYjMO0s9S0tFcjtmxa
prF2RVLOMtxrTtNhU1R16DLLLK1TT0Sp8JjG/z7NrVL3lfWG8ss7vN47u6synH86uPO1um3Sf///
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////9bBMkTJUbSTmVsOIXQgFOcZ+CFKwvAp5zH/U7
Llv3DzcF3r+YAAGyvvOWbvcfy+nSGUqEm0GP57/mt97cjqlH6l0xJpbSw5JHngCg4MJisdjr5yC1
XeuIvtKbEttLWob8FW5VMPLK7UJnI3Zlkixtztqcl+6k9GJmzS2bktltLalMpxjURs2L8PVaGfqW
Zyd5NSbL7HZPXmsPzrW8u1p/Cpy3Y1Q37NXOp3VjGtlnjzu+Y95S49zxqsrgk7VbJTjdSccaTag0
pymsmACZBIETOZESBcJoa7VctrYUGT6XtQM6QTJ1K6pp6RuvZmrWreRCMFiC/BacZitnHKarb1Wl
1uBQ4tztGSrAuTzUzpy62wq0+mRndubDmPdOt8yaUYxFQ4G70KU7RU6znLBDJYrjaKN42w46vblS
un57luNtCmY4IaiVN2KJVUM8Ojxl8O1tvoEj+fN94+9R5qyVhY3ExaRk876BPaTT28OJJD3D3qDv
V8WtPrHzvFMalmrZKcbhTjjabQGZNKZCWhMo0EDnUuLAu0t9nLBXVsKmV8v6acpHoKgYlWnpqjxr
Yc7k8a1jXAas/M7Z/tNW3MXJ6/AoYGm0rTIgNSdJufx4Qsl7cV2WBOJZyZ1DRzQ9FmWwlsS4mj1E
COsy6LufijQs3xNFGXxsGIG2LA35il3XR2rynN8fRJktHOg3TWJapU8XxWGQStTvDQQlLrtiYkmX
JSK1VptTwo8bLn7uoNokmNzb8KB7PmSeNTsse9ZIe8u4tbavJazt5q/3AiY03xD/++RAAAAJ4lhR
6zhLbseMCi1jD22YWYE5jGXts1SwJ/WcPbbNEqSSlONpJsqhEgV6w5eIhRAZ6u9s3gFrzWlqOTL3
qgllCq4gVSyynnYpLMssO6lqmBiiyyX4485+57WOvuJZX7yEERE0dQMLmAciXEwNkAPS0WgMIz6x
Es0gRNClYeMNybYTYIlUK4NNDCR9QlULylRpk2SSSUGYPRL0Y6aKViSa02VFNVkxbkkbEyCUcTaZ
3bis/nZXJ3T1iUqYnvTGBLxIOFHjP///////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
8kEpG4C42kmrc0ylaaxJSlAsXug+7zU4JWGdZoLTaVu0Mww3dNCW2dzsUhzVN/dVY4bmvbnvH8e7
frGcvYaSikfC+jhJ8rizVkBTrBVPbliNdJEyhNI8ZiiZVpqLk+VjCm25Kq5HMKnkV6oPl5HVKtPU
1jmPQ/lU8ULgf6mZ7tLiY6MkbjkLq5zxkXCcMMaqXSfMSK+aZmSBhhfMkGqmT7I3n45PaSvnHcsO
Vun6Rbo8J5aW7JC3CcH94bexRcaxd5mt7Wj2hOqSCU0o30rWlbI+oZIlNBWoBIzRaKJLUVLX0c50
10rodmQJOl9WC2b0a+zN26lXBQIw0jH4KEUrozNTNaOzcJntV4ow8v5A0Ts3Viq5WJpLGayNAZiF
SwUNL4W1nu+ZkNnWD+T8zGZZ4OZ5mg0x2+EoWg9WxHl8lYKMK8zsM00dwWGaSROucCVmyqG+rEjM
s0ZxWorxlc6R5ZoMOzVGjqaLl3RenhRIvmbr4ev9xnuJPDnivHu55L4mr9wa41msLes30/rRJccg
TjaSfWsXUjHUQwIZTPcU4vLhg6BHIb9d8mWJQy1ZYJ+ra/9Wg7HJTH9bwgKqc6F6GnWbmNaO5yGV
5VrD7pgUe3xflYrCuViANcYKEJoFAQpzSKdIIENZoK4SxknMeBfj3RKLH+REIZ5KC5UMO5ol4MFs
QQti7XUZcrx5nrVoYz6OlPHM8LrOsOkc1mKp3BPF4jHM5q08mR4hK7yr3s14M7UtsZ7KllR8RcWU
yw6zFbtuChnnVzjEfPGNpVsRO4YrR7Oqtz9le6i5iN26Zu6Y/1D/++RAAAAJr19P6zh7bsCsCg1j
L22ZUYE/rGHts2qwJ7WMPbatAuSSlSNpJwlW55Eg4fUk8oDke1mjDKjMn0gaGmgS9pLYXdNilrWp
mJxaPu5T5aqrTSrOewg0I+ks1Pv0dPPtigWVJK1ZGf5bVIdqyh6JQK7ViuD+IhXKJWMmC3qxFTGe
tVJfDgJI/Y9iDrURMOJsOk5MtQC3uUyEocqEG2bcj2kbGQ82FRwWZqT+1BS79TzOd4Ccdbbsx60i
QrqKDCq9cFeu4kOqqrSHqHjU/7+2YT1ggU92rFo1YGV6W+Z8UrJmd7op////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////mwpJJUpG0k3VR6cliaP6
z2gi+EDVwK7WI05fkjYE9jvxFpaxTMIUutzdmNRmHovnqUorlszM7Hh3k5YxuZdv4y2ALsELZtwt
nQ1WKVOrllQnKcciREkZnJlVGznVh3SLlbYy/wJoTC5zl/Z1QulQmKKzCbqm2SRYfMp1sUaOf2as
E+GeZ91fAdUVbHWLGnkbnHFmaG9qyMFVdBiSxXjO/ma6OVLw4rbS0LeY/tGiYpArt9jMasDcbefG
pjwM7g076NBOSSpyNpJ11oQ4tmVjkSpQ2PEiM8cpNdtUFUI2VR962dqGz5leq+WxmHG0g6WwJldo
CZBjKF9FkUAMXkFemp5mIu/1326RESlbgNCUuzISvHizKqO2MIUNDHOVWM5yHqnbnzM3G5DJKxIc
jT0SCc7EoEUiaTrpoaBSW5LO21+kzeYKquG4tK29ZIa0zp1XMUBsjNkaqtZIqmgx5pTt2wvIrhiN
dyi3Zom+9it81UrFz6s27stbXkzt9Iy73pjzAgao2V3PE1nwtq2MgtyShONpJwWyCClV5WrOVYCJ
8XpFXJ1va5rbuvHYi77g1AUOLOp61GsMViTyd/ByVMzbQWGymL2OZS+hjr7yKH4IhlOqVwW0DHdj
pP4mqFJtVYRYONMHW2IY+JYVJw2M1gRByKw1TYLkRBGCYF0VK0jGo3XysOg8ECB9RBlTn+iTPH0i
G0sZ1l8L2c7o4GEin5owHG7EqjAc3FCVY6RSGw3ilO9XvTQWVRqIwrUWGhzI30b4qreQVhZf1Vqu
eP1a1wo7zFfCVO2KZja8Nm4C4ixnNwg+zdtCf1j/++RAAAAKWlhRYxp7brosCh9jD20Z9YFJ7WXt
oxqwKT2svbTMgpxt1dSzB2YCpRkTR3uBFC+aB6w661ro3J0p1qYF02GNKXypsYwQjRP85uku37sv
lAVIGkZHGZmwAMtl9etNUnamqft2V0lntZFROn4CrV+md0Pc07Qbw4fmkUDQr3NTquWkS9okRsrC
jv3Nrfra2LmoyEI2O5Nj+YnighRToUKfbFTBkjxnsO1oGdvMbb6QPH07jYtEea3mmrv84xA06p48
OJa16Y+MarbV81j0jzh7D+nif///////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////7UgN
Gd3cu/bW5c8wkuh2Xy8wUc0MbGgu09daRydKdagiP7kKHKqlrjooWRC6W9bhErke89MKLYHB4Rh+
b/Mq2HbFSbyzlc5RdevFZZjbEuo4DmqQ1ydw220VtxFiRFlzclKty0ZM7eQIErFHZ37ar1tnNNzR
ihozRI8NcPIEVkVMOizLAvthlclXT2apLN8zZJCvGfUjxHDFtateHWTDFiJvcZviWnjY+IEk0u4F
61zSWHq2PT71nP8C8QYkrMqMTfvtu0JwGYs4htiBdofdrep5DDUPuwxyGcojRw2+4NDp98vcjcIs
csXY7IAJiixGse5Z/jfmLNBfwZLZnzfUz1OzsNGdrmTSgS8dzlQykj9cs6pKVDC/pA6ISGppNsSs
V7Aezo34SSNB6A8pdNIeTlsORQDgRiOfncbiEqV0fyAU7twfKVnXDMzOnbe2OKlP4rEW2nsqD+WG
JSnGw3jMUSKuHByqqkzt6oFKjnBxnZI130Zjs6jRdsmmaHE0zu7Qsv48O8WA14Sv6JgxJVZUcnff
bds65FkttK2WJhBI9Z0XsOVT1HkiNSU4Rt4waDP63VqQ3Can3rsfjIMpUIjW+5f+Nqgk0cnpQvWc
o1zGbVzpxqtLmBQnCbS8aGhlWqHBh1VLUfKScGo3Uql2pwXNEkjU/CeHBBCApdKPy+tjIhh4Qk9c
9EMer7gxKjL/CQQ2JAYnys21yOKtRRiJ8+VMyJ5YfPUe1se7PHiQiudVcuarLYvpZ1F26tDhWb4b
i7pulbQ4lYbuBC8GPDvExLIlf0D/++RAAAAK4WBS6xl7ZLJsCl1jL2yYoYFL7OHtoyEwKTWMPbKx
gpNJgptySOCr521ZXDh4kKB3Kd22IvJPamYjVp8qehQAT+sr1WWQFj+v5mORM7ys67+OrmH17WD3
3eriPNaKpo2oinupo24U8GE40niagQ4CtZaq6aaHSLt1rdItk8PhUxj+cFcdsdmTScmczBOhVoF9
AfJpFMkF+oXr+DlqWmpuYHN/ldaVbHaG+etVrR4u5rNi4iub941Obu8KHWJArB8S7uWF54NocW1Y
8FmxNGzPusf8t///////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///////awUmkwW25JLrQlrq7cl/iqMHqbnTslfif1Vm43ayp9l8JH3KdryyAsP/8agpArvLHD+4/
KMrdPTYLjxyXEPGpm6NArD6mphqZ5cOsvnWMR4DKy9mmmY4tcxPiJLO+HIqXxftqpOx36oRER2UK
GLapjQoyaYmCDKqX8dj3ZVQl1EjscrZhVq+8OdhbrWjxdOsNi40/yyMEdVzsVcPKUbdUjzw4VMQb
QXC3jywt6tifdY/5aZQTR3ZXC332/XTBD6s+bHHCoaBzJZDDLHFlGT7VYY+RT78ixpDhcsxKQyCk
/n1G4mm6a0my/ePft2qO7bjrKLVePpPI1+hKqVioaoU6d2qPBRkFqP5QsEBac1KW5UKFlbG2ze/W
UsdbKfCiP8cRHQDzcVZBQUBgXa4lkep/n8n1xqqnV9lQwR3KzE37cI7i7Sb1mnjuLKoW5EzwlhmO
VcxXjBAlQh0wtyZZ4D587iw4c8lNRI8B3mBm1Y+I16Uh/EdtS365ECm0mE5JJIwWJMBghu7PCAYT
jOKLUcWGMpVIYhhR9hIcKQ5XJbWkM7h/PqPCbdl/nNl16vS0/KO3bvRu63S1K1s6DmTR6h0mkcB4
GYf1DplOCGpS4NbAZxYVw6Q5PoaxKhAMrU/kfqNAIUZcieP4/xjDU0m2VDIprmA3JFsjzrhF1SSH
qZ7CSKLYkAwP40J8/dppVrLMd+Xynjva0YmvcJktBgzUVGLoyidbki5QrR7xIba5wIl9TtjvwI8D
V/GZ5KQ84u2rX6z/++RAAAAKFGBS+zh7aMKMCl9nD20ZmYFJjGHtsyiwKPGMPbbYUTRnZWL3223X
lGoOYu6jSk5BP1ik440vgqjq1eVdWr4ADXqdtZz1vWudl4iCGgX9Oaz3vuMvsWIcr2V80lRcrzao
3kJgf2owkDewllygLpmlbI6dbFKup4F9LjUODZqjN2X91thGCeCwnFBHYqNmyepBIObe/Wlavrpu
3RTvWPM0BZgRllwg5jMVaZbn0Ck7t41wmq88KeLXM9KvILfvLa/zaSrhX2c4r200SjHDZbbza0PO
X8X/////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////JUTRXZWB22u3XUwGDGDOI7SMgfSvyMOtL4lR41a
9XkukYEPblF+3Xn7djXO21DQfChw/u//c/KJBGL8Or5pJQi266HrFIDHuROi7sK4VqeZDMQqHhVo
apDBP6G8X7m9In6xl6dPOc8dHTGihiwwRJ1U9xBJiiDcS6thsyGym8rNwFOrX8VYjIa2JtlWG17O
im2JBbk9AbFpaqytiSvGZrxaRXLT2ksGFZ7O17bquFfOtRXsaJFXlPDWa3iwpL5y/g/qrQKcibX9
XE2WShscoZeSQTbiF5mzNoFk7lNIhTNmDQCjIOklm8qe5Xv4WLnFKWIgH60bVLvmdHqW0PZXTX1f
Z1FXCXS+6upnrLHWxyn2oJ0NIUhS+PS2o0lViLXB5MhflUSFQH6zIefwtyeVcquVY9RSn+aKnhq9
dvT5fl5PhWogui+52TjIraoIxyUFYayBbz1eQVahSijIhaSrgzKSZmfx7St1Ijc+qq4UzKnmOEuG
p5Bs4YbUUnU+3N3m7fu8VXv4MNls4S6+oEsBtsQKcaY3TW2N2FYHplDblSACG4m3mXtLYPa04Dvs
XfqOtwJWVLv261Wtb5hxuMhE7KutUv4Wr9+M3cpumn1RTPGmEvJE6dMR0mih7mSFRry+rUOQqAXF
OpUtz48mA221meMcKVFK9iQ5XfEKc/kqi2F/Eds7au8q1FMNFIp6dgYieqxpK8bg/CKJrEinwu1C
ZS2qUOV54zLRRNbM+fQLZmfPmZ4fbc8UKeurUgkmWI7dYUpvLlD2Js6ojN+H8zGzssdU0miwsVgV
gNr/++RAAAAJh2BS61h7bMFr6l1rD23aWYFFrGcNs1qwKPWc4bbRFOSOFKNpuJ6tBbsvGDWjioQ5
4FZ1deb/RqVuBx6dUc3GQbF+eazlElqa1nlDS+TapelTWU1njhna7jhXTw1i46bURVZRBpwlaX0h
CCbnKRPM6l1ZEzvV0n3pyt6iQlmeRaMzRo6ledThLVcrO0sYKsq8UUadPMKJexWWAbx9rm6cZxzL
KfRxbVLIhyFEuXZ+HE53QqVTvnujOVZ2HGrXUqoYlp4uDqfvDShY7YhKidVMaEr3sBeZo6ta5nGZ
XWwzNum9NN0VrbMf////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
/6Mpy1tNxtttsrTXidVhbou0Gk2pRtosSym30+3Pxd9H5AN4dx3jhd5rLtqCi8oim+DexrOGs88L
d/ePJKPIqUrjVcsDa4H4cbc1nKXxNywpHbefrZHfzyH8l8p2CqkbO8pZ86isz8uTIrSSnaatEGbq
424EqQ5BLolJ2m64ynYhSqYXKK/KpxXaHPT9rk4lU/solu6ugLliWWBeV6cV93r9UK5aeJB3NAVU
KaryConXZrRa6xCj+Vxrq9rbzm82PKIzYSmrjSsjbis8IjaCjSl6jqz6oHHZGowyxa7bT67pG5Sz
5Kz4FaNDx1hnduYXZJZFFR3kzG0Ab82t75vWPO9+aQX/G1Uir6u6+TWHnjLwRgG2a5hnGYZjupXD
6uqORPU/48RctSXfqlht+n/jEtqt3WLSSdPWw1mCmvQFk1l/cqs0/8TgOURWKWoM3A89LL3K0+7N
bKkkUjrzlFZlMgszkj1MVIzCoYoJXal0qoZulltWW544TWNbcpopq1fn7UompPyvT0MVsZZ2N2Z3
udzKW08m0hTuzjbskbjM3QlwKAZUhMHaTTaRTeMrAWYkW+bjOU3NrCTbGWHAaxofP1+6DDOOZIFh
d8J3AyN23ndpM8uXt/XiQKHrct0kzMyGcciH+PpDgXdAD+y2GYjHdwt+367biT0jwH1llNFMqsFu
9Fn2lcmeNL2SuMKjbAsCyhtotaaS6rSIoz512JsDdCIOIzqITsNy+KTmV+kq032L8pfWlsZUssrX
IGlXzkRgaMSyjh6FTVWZxs291ZbOzGOrspux6/Xjdqk3avzN2bvYX+4W/vZZ1N2KeWD/++RAAAAJ
0mBS6zh7bMPMCl1nD22ZfYFBrOnts0gwJ/WMvbbtlOauOSyNuNYZ06ip1ggoAQJj8CQ7uphrUaio
Oz4BILJobJFp/BDANKdn9XbXKvLsmp09wE4BdCoGlunQRmXYUVeWxugvIhjJHnrKWhvpZ6zqpRRn
WCbD9T7Yd2IDqRxPVsTjkkC2sDkqKPHKWA4t+n7b0spj8gqBfqc9GaWPCiHgrV9nY2hsaPdzUDqE
ss0NY08cm2rPPajFDewMRIszlCrB9n8G0KPS1KxIWcy4ngzyv7ZxBj1xtxiy5xSttYrrMtf/////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//uFO6uJyyNuNYgaHExxGEYRw4aT4LDuKnW0xFkBBpLAphaNH5FNRIIQBrSG3lVrYVdbvbeNYxwY
3KA6epS02HK8pl8xSJbjonnpqLg+WZhwqkKfsMEWIkqLgHcxs0SZ6erVlmThOUQqq5dPGF0gUy8V
650a6KWGNDJcnPOrmxnfOikP1dx5YrYs7uzpp7CQmRtVFHjlvMd/Sz6O6aol4FGbcXvMs7a3NU+c
PIkCS8rfjxZ/BpmSLH1iM6cWvVsXtqmtZ8WpFKSSpKNpJw41VfVOvybV2b8Kkp0eLstoshQhk7bK
0R9EhVJIFpUX01pvZJGmv0liJFwRACOHGem7Eak9nVzyxo5b2YRptZrChTy+ctCVI5WLtdJZsVZw
KFF2V5msSiYltEoQmoMGzkv4iuFnahQ1qUSuR5GCWncttZbU9BdJA0m1CnSp7xHPqWVJwLVkNXKG
UUqwzw3JzX2JzY1dFi4VnZIiOV2WOSHGexX0KFHWIlpmyK6jt8ythNy/LJmE+l8un1GZ/LSO41w7
ereSBLbcKUbSTaZG1GqqmijqvjndZ0Npx2YcZA0CB36ZpbX4z4DAxLdh/pDNONdvaplykAh5ixW7
EaSeyx3axnp36RGn9xVDOdKhSo3ksnk/IQtQJdDEouV0gyzbjqlQpEj0GQ5ItOHUdrDpeU9ThLyz
ELXjXB3I1cINOl1UyYYSWF+N9TE0habU9ZcLcEQxVXP1+cG1KqC53VTUk3a3VDoMWOsQVZY4jKjM
bguWqDAZo766o76Y/KoyG3yOMimMN+uI8Jzl8rCrnB2u4W47LFw7erb/++RAAAAJtV/Q6zh7bMEM
Ci1jD22bUWlBrOcNuycwJ/WcPbbpBJySFONpJuG5UsX0soqEChoDCCgL8oQ0qfMaYG/6lFlmTWXC
Oj0U4ctVZdZ3Lua6wKVA3sMzeOVal79Wgpa9K3JGKL3Vc1n+zL5QLb5WM7WhabQ17huXkRAcU+80
nV2cEOd8qKqI72ZsbdqBJqc/nE/04r1OoE6txo0VoPzKeSi+k8KTopdH6m3BtRGm2AzKrW5Xb3PV
8GdybYTG31cYjBuKxYpTOYuHH5hTyvJH9Y8JwZ3Ol6RKQd3vLuS2osOmIf//////////////////
////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////2gVJZW3I2k3TeDF
PZiTGiQYP83ebT5h1FGga267uVIAZzGwodrdi06L9WKOT3pi+I0Jlg4qYNPn9NKc8atzHd2PJZUf
Z19Mzrs2GluYH8clZ5EFOVwTymSTAjSVlsdnK2pxr8LTxaX4Tc/qwMbWwHih5cCfoWQgoVO5og9S
IgQTSPBcolCUhBP5uYVVAupPK3NyqxuDPBg6vm0e9m+WrqJA9IXiUgwYuK/UKNbEj/F4Uzm5RNxd
UrG/baT49YdMQ91opOSUqSRJNMFfUBtCX6XKIHTiISGZw4jHFfO82zPWcOU2B4UjwAc+kptWowvp
4578qqsrAxBAg5L8612zKvhuPWHboYkiZL2CO5HoFbHMQ3AtPTPdBYMeiWktSsFYfAkANIT8XuoM
4qs6WL4zTdXGgNKFlTXGbRluDcpMrluqzYu6sZmpqZvySNS7OKzj0wDRvDRNevulJb8Th+NQdQPn
cfyO0UTilemzpb/zdPhGqV/6X7MZlE5aqzkhsz1LnP4UNSvKbt+Jdxl1JYynKapLqW9Ws3mwoLgB
zMiJTkcScbSTa7AS6FhlePmVKzWEV84kMq9Vjf5kyxVhGvOFAaAcEMgTOtXrRKV6zuUoqks2INgt
E3qmmc5rcbjfZXnPp0X5MWBXHCUakV6lb25HHaDNIeZzdVXup04VCFF+TSTMSyzbT88HacVVCeQ4
aBb1lyDhcZGxhfr0OO7UrMfLG2HewoU+Mp+/X2NidbMdIIYi7x1BFtWrE0v4+lqKxsMVQqV1FfMM
ysgI/3jyseIb28ZetWNFcLQF1iFBibxFtBtjV8a36OL/++RAAAAJOWBRaxhjbMkMCi1nL22ZCYFD
rOHts40wJ7WcvbLRAuSSlSNpJrLXU1FlHFqvAN9hEhbd5mdv/CoxFX3eSq77SYEq08MOLBsaufnq
dWkZGF088Lef5fUnMJFG5QnLJ4YWFq5SQnqHSgfXAcI5ww+Xzc+Ek6VLo0G7iwouuwI4yUkbZKZy
uH3wsOU1YOQzBcuJjB2wrOTtGWEapz0O1X3KJnSa/HEWS6/EbIUcKbf17HKc/WC65uVC2rUnLL14
WJ93q5A39HaQxR3tLdN/do//////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////2MpySwqRtpNu7Omusgh9QWCA8VoDevG/T77l0cnX3fKcl4jB
aZHXbiEpq1q359fVdxoYFv+4X6fusIciFiXROIKOvM1h4zQUUpmpxTyccVkzDyVjxbU6rZzdQ6G5
KdCocJ4m61or2NyXSjgnepXxwp8RwmKmlUjid47D+P4Og7BMyUEvJ6S9Nl4W30WVrjaY2RsT1Ea/
W2RKnezxUtAtK1VlgxtuFcs81m9iZ5EMUt2LCtlZn8N596+ozY1zwHGSHSPLbb+nv7xL2MpySUqS
RpORtZZwm8ok8AzQow6j+DxwkGrG+rIGUOutvJsjAwCSK5z8qaHFrjk/hcbJAR/iWSpcrOVnuEPU
1vKGZSJKfN+lPpzjyNytfoZk6AGZuJCq1aaRlnGq4V0OgGaIsT8hJ9JQvROpD1OEsatbkNUSdTyY
BvsJ2m0XQ6EyN9GGUqSeJsnKSbJnBG4lbo711ZVP8YpAmpFeb02sqtT0Zwtudklvq0GM5Oouc63E
h1vfedxtNcslqetb7vNmPi0GTVZ8zVgRolNyQqW222Rspdh6HCRsJJh0BGibXU0934EaQ9kDs/uL
wWyi1NblcNNTfaVRn+XHojxtylqoZ1jTTv4PtKqbCMwChU2zrDDYUeRa4URkx00kw1ACk2kFcjIS
44zHMOMcRoK8PsYRViwoSoDWHqcT/JaZay8JSki2n8bAtdCel4L4Tg9SVnAUxyj0MZKT+J4ch2ng
dS7M5Vq0iTijIt5ZVsydViJUDGvolOlhGEpikUxdU8jE+q0YqjtVRTHKsq1ZaGNWItld2d13Hai6
vV5acGZhrKx3cXqfuf0rA8fzysvav1j/++RAAAAJ7WBQ6xl7bLxsCe1jL2yZJYE9rOnts2MwJrWM
YbLNAtyWEuNpJtTa68bBH6YYWGHkcahc+wZ8aV0HTka531ljvtJdJ3bH8iH2c/3fVkOItNXLP9fl
uTYZY08yyS97GwppDUS8XbEqm2hRpFOQ40y6fpNxS8NTOlM7UEFmy1Wo0qtwpV86TynPpBq7bNSM
u4DgrqtjGznIwuTUwWvvvUgxtHVkfvpU84woKpVypfS5eXgOMWHI/tWzi0wdWo0xH29K+8GA5wc4
/vGtEhwnld2rWbGY1t0e////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////1kFtyQlySSR/2kr5gOmZgVKBc7eMeZ
JbduHVoQ27ztwy5bWwqNFIBlXaRsEPwn/3HnSOAFGm1n+v1nRc7Zlddzb2bG9ShoqWI1wlUpV4qz
9YGW87Eu0+rZFGknqmVyoYZ068nkTbOsRcMasP4/0BOpnzuRmezQGKqsu/XENy2rHKf0ZUgnzxuw
RpLPVFFcnri5KmNSG1b04y1xHxu0V22xW6kaa2ZWfbCwP63ta192gWhTV3PqtbWtveoP6s0EpJaD
I2kmvhoqH6cZIHCIaOEoLgxlIl8ocQcUBUuiS8YJp1MzVwgEZa69cXfeNPG9v9+UtCM2UjUu3rH8
PlsimXpkNKMgYfuucNdM6eQ1E2TjtJjLb1ybh9JNjUBc09ZStR1LcBCGVQKpMQ1OhTjPRJTNZmuR
QF+o+srHrMni9VNlkWlpac4rbaAxP3BNMUFd9EqqMhjasrSuTdu5OUKGv1eQ2BjrEpdsXVLN1mKC
yP70mvA05N8ske+IFYEJ88w4dPRv749549RBbckBkskkUUXKShSvUNbgFaHcSc9RUrKPRwe1LrNR
tn8DJbhWwbl/XrfdrcanHM/v3XWPflC5dvWP63i5UZZnKoikW69aRTccjrhQiAYaci3EyqVrKqqq
TBV3w20xHNc0XXy8TDpfSQw/r2RaCIjAcKgCh+NUkDsxo1KHilNHAdSIy5/mpSt6YhLmPSKe5BdB
EPl8MQmHsI/RR2LS6WV6WFxqHqezTT2u09y5frZ272Xakeq5RrKapaSnjWtV7HZ67P63b7LMbkxJ
KTKiqRKtq9dwwztS/9b/++RAAAAJdWBOaxhLZLpsCc1jLGybHX0z7GXto2gvZf2svbCohONplSSS
SRRfU4uWPsKTJB+CYDuMuZJDbI1NoacyMu1cYmQRh3drPLUXv//4KPnjK/ory3zl7kqsyikllUtk
8/AYG0wNlQDogqDYCqnSYceyo2AqhMChEdNBqhsYaQiIfeRzUC4jE6g2oA4qBlYYQFy4D2KxgqLr
wKJAppOVTHjJlJWUzLxRVDqFuIJrTJyWBAjfMsjXIXsIyBeDKHyRrM5jFoYovqmI/OeQ81Lg6Gz6
upf/////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////1JJyRwqSSSR4M5SqWC2RRMCmo2CFF2DRNeawz7MQfldTYk5xWVlte/A9/rT4t3
m6qf4Wzhp1bWfbt7kq2/lJLJYvJ15eWKmIHy+HaEpH8krVpskOj1YZhzbxIPn0whMPuD8WYD9q9D
grlfzo7Qj8qDrG8eFczJ+rxwK43bK0DhwjTrWz4sosiTMVNyYsePbv3LcBfP3Uywro/WNq1tlC8v
R5zLWma6uRsYzCu6qzN346QON0ZyKm/Sr66UIRRmdYC/2tteyBke3VYOmUDBmbqbEEJbUiiy6Jx6
1gXjU+wZOg1ClMpyafiGqqQkMa5u6ouF4h4aKY91lLs14OOxFssoZikyzmVHSUhRktI8sJbhX7r1
CNKZrTDCglwukJei3nmfw47nuhavLnGfQD/L6r7nyY7axMijV5KSIZC8MUdJG+jB2munWVLot6wN
lXxoxIUWMznMnlO9P9zVD0uTArH6KRK4TURZV6RQ1QoBMK2Odq2lGdqb3M6sq+d4nHlmmB87zFxE
zHlp4OoSxWJe1oeYIa/VKEQmysjF////NAbkpWuxz1FiCCA+aeNIqpHE0l0N5C14vi37hKgOARd1
6PUEup2Wdy5dliLpxRKwRDlqtlFtsycNXL4xhqsZhmgMU8TtFxH8oSDEDO1JKYzEKXB/IQglcxF1
aC7xy2CxqFIqtLqpO2YjBVrM6T59rk6okEu5BS8HQ2TrtgP8xSem2xociiduDAwQF0dKy+PGhxD6
L9VWs7mqIqiZWRvLknVI2RnTCZqGqkrKOK6YbtD5mbeoqMb6A6szKqF4M8N7rF9w2ze4rE6gxM6h
XlCZz9D/++RAAAAMaGBMazljZMDqib1nL23UwYEzjOUtsp8nprWcsbeNAqSqEySSSV07VgVKknlL
zADOAIiLbxKRYgGPawNDCR5ZV4WbggBPEPDWbn8WjkZgplWVrBsYhLNLUmHh3Lfd93Za7LLMJiKS
UDXDpwvFwmHhcJISmo4mSollgconUTq5tUSml5BA66erFpyEq0eymfOskhUrQjQyTny8oLC8HQTH
y8s2P1p7g5HS1taaFSMxEkxKz5iPpgzZcuRJPNIClB+HLjxs9DdWjofPwlcqmLi52q3V7fUrZ74a
93Zd5d8ocD3Whb//////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////sRTkrpMjaSVVfbYU+EpFnAC0
BsF22WMAHgBYdcrH0s2svyzYtwrAHlr1zyfZ4IDiUauWqSSLHAA40vS613v7xe2WSF7Wxp1Q/SvW
xeRTJFZD9JCXFMnUtoeqDuhWmgyqWxzKo52V6cqVREGR6yqVWuSUu4auyI1iXa0zoxkXRnE6jMaN
kc1S6hK5VPWNtcFNs5VbVFLTasIZmR9FmYstDxcPr0TrIrneJc7tpmd5b2ODAZnsWD574cGhriWS
eOFeC2IFyx2vpWdOVmEAxZbw0gGDjZoQE/oIAjI0SODpWCIJIchBWupQh8cELs0ltprY3elTXPuW
guiNEDI4Y5qK65njq/T7odx1tOW5NMJCLaRLRSRi3Eop8IqER9rbMjuHTtKl0K4rQEMHxVsFSVbE
qzcyKFKZ+mSVWEVqJ5ikhYcnBfYnVUN74sy35PaUhNKrvcZVZQVsPlr4zqWb7uN7UPGf2Xfd7F1i
BctdTkbRKfeNpEDSS1i4qCcjJQHUqqiaiZgiBQoQGKUsPc5LwdAN5N36mb+x9+qOGNatIBysYsYg
kaGn9/VPexi8isSXF2VaYzDZ0TooypVcmjdPlZMcIi1iiVIIxvB8KkbQFMzaOR7LuGahKhKs1ZU9
JywqJuWlm9SbBt7KRJMcazH21q2kW0vf93dnJ62ZK/6LMjt+/eerjAQ5CGm0zxY/2JaXKzj/++RA
AAAL0V7O6zpLbrdr2c1nSW2W/XM5rGmNusoupzWcsbexlS6ypWNpJzFCIyFqS0QElnB+hcGQoQ+q
9FbSIWPAYcg9H1uigYKpIempXRuXlB0/rPSJpYJhS8EA5dZ7+sOuhBr9MAYe9zS2ivzSuNzkkZWJ
2F0AuStYjKoVlxWKk0WSNMjzM9JFViRpgjcJkCydETAjYNJ4eTC6NkicJG3lGZdEg1jULa/Rm04N
I2D3njcP01LhAhbUaZgsguFWpaK5Rp06gnbUYIMjuSura4P/////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///////////////YintXU5G0k5qbSOZJTkAKuBuyGapAA4KrSAEeIBoRlCRTXoZHBAJOSjt3JrdZ
7Kf95iAGSmTD5jQg5qzT6p5JTxKL1ngfeB4dgmUkQrQkxGQMHgOA2IDRIPBBFgXLmZJisAwjNKI0
aAmDM0CichAmZI4AUZiuoKoHWDcJGS5OvF6EUI2yipuKJC2g1hsj5t6cTU2RwuRwaYYXKrIyRAVu
j7MEkHYq1Jyi+KWI6QJxajCDrldXDv67EFbbKVI2knfUfSoCNxtA8UgU1B0GiFyAdcgU7TUE5km2
QKVtOGBJg5LK4hDMSmobf6Lff27Rc0zakRgm9v2Lv93B8pu2qa21KlmUizh7OzknXZKRrEdGfMHF
+Pgbq1y0kvqnhWuLJ2JemGGZ+jbM1qtlRVeW6LSWWCnZcw0e+nTLoCkjXlpT7pqsPo16V8/x5BQ1
9IFTbN/ZcvaKi5dLjibIlFETllzaebVXZ8eQP0+rdbfSHDYFdjKl1dKkbSTlzVUeAMW9Zhhgxwpo
LUMoSsBwYMKZYlax8OSBgTot8MDiGOI4UsSjj/u9f+180SDmfmgme2/e3+e5+hoa2dG4+MlPZ47S
pY49Og8YOlcTCa6g2Es/RxCTGTkxDVMlMr2PLFdPR072NxZqtcw6+eF2zSKOJ5mM+Qml8ZktyBEk
PqQwn8fLozlXWi5e27i1Q/Cw5bKsO5B3dV33rs/KKPP+zX1tWrPxxTztEk7/++RAAAAKiV9P6zlL
bLYrCc1jD23a2XVFrOXtuvauqDWcsbexFS2yFSNpJwI9ajTOnATLKthmlp8xABNhwydEkRGfxnmF
RtXpNSh6Lsll93P945/SQQcDxfepv879D2XXIjNSyhYpXtIDgBFCaQokVahbBhRtkuyC7xhNozBi
lwNNbp8SJGgpBkwJD0MAIiaWJESk0xt0RSkI8aaOaD+oCyIwSNuRtxYWIE1DqyOZGshk6LTpMdJp
n4jbTT7EYL3Kc9Yi0tU3Tj/kfOV7XXT/////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////1oJyxwGNtEpkjO1OmGO4keWMFl0aY8GDSScV9lXK2K3XYhSdM1pV
jVkdDdw5+9TFIctKZ4b5vKr2PQQ5PZC+KVkMwNEhIZaFTGHrBHPl0rXA/2BErB6qs9FyplC3Mi4h
kuY4R4IelXzkd0VlSiATTPFJgqmpdJxHLqsUzYjYhqkP9GIdmFGg0gbjTQIeW+PeJZgy8e7jx2+M
9hVrua0TFLRa7f2lzqalL5hUvevti0uB3GdnL589pU316e1sjjjOKoYnoSAFvU3h+aGa6Nt9PlFZ
m7BEbXadBMZR8AwvzXqTj2vMq6E67x+2sBqYk1XrV/3zrEn0a0wNf6WrMWm0xdTwMJPjqPMlZ+Fs
PcuJ1IFuJwQG5JlXQmSpD8lP0laFHIWwkJilS1KlVHODdMQmpPj+P4zkgr00ZUCDFFthlSsolFmE
f5eCYmokqoqJMXwvJxqQyz9OGCnT+OmLRTnST5UmOarheir05sWV6DqC2wmGEyyWliubj3szdHki
v8wd0jtszfSPTVYmprbzCvIVNtclbI24yZpKbjZF2DQqDRTdAdOMAyIvSuZYydzx3pIqk3U0229o
5qglr3ute53jzvwC10Drut/zXwFDEBRt7mEvDLrRyiK1xKI5bYLidaTjlwTi7UnH7BCUFTzkO4Co
JBBUjyhWVF8BpYWpICsNDKtEjRHp0SfL5ZOVY5EtQIKAxNqsnhQLbB+tb5ahGKzC+taNDcixW5Bp
GdXOjmVJdaKuOrLL3T9T/ONL0JluruTdl1DYeg6uTE8TngD/++RAAAAMj19Oazl7bqiKie1nLG3W
HU03rOWNusMqpj2csbXRhO2ykyNpJuWjYl+oC5yMo6aBynTdguq8rHggAmGYoXpedgatyBpyZRim
473x+HK28NspagZEokRYy/XNcvWY9N0r8xys+uzrYEKi5Q+Ocy2ThVOz/S8m0ggKNsyrUh1uJWvM
qvUB08aULaTzcnBXvzoU8XKsynlIuppFe7g5qqHqoZVXqMoniKsysdZVKu19WxXNsZFNbbBE+le5
Q2R8sTbs56a3z9/CbYumh5WtKzqqO+hXkmvqHm+aRPqe9tS0if//////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////+sKm2lStjaTrsMV+j6+yCpYNBcVPEAYK2jE0JiC5aVGlq6q5f5CE0D
op356xb5f3q6jriIsSIyxlzv6w7GYAm5a6KgUseGAS3Fxg6Sz0nGYIE4+DtUpMyERFF1hROBLZLM
XK5pWB8/eVTjbYIHW3NE5WJBccsJa65wvHw5PD1+8vSmx3Z05hZW1fymQcxWebs257kzj+XveHKx
XipXer8eXgOrl8NZjJuWspW2UqRtJJqrVBI1M5wTiUEG5nGFpXvZIlCGBJho/yWSM0T5TwlR5nkR
FNYjUbkDuRn+ftwzdkMYuapcru+5UFPDO4dlzt9dEQWjheUj5eaGJka0WW9IwkVLykcPnDJOEUxM
7GLpQPnmSGTyYOL5XOTp4SojI29DuqwMyStH2FY1ZplKiOWHCrXDl5p1bAc3O1DTcepoFbkDaVJk
dHra3BVE+zDdpTuursu4N7NZ/r7hlAzqZeVP9rbXrzcUHDoCTeeJIyyReWup5KEvkgPRPcJzJSlg
mrs9TSsSmhh9n7hhVSd5zOHXGAtxjEv1Kaa7b5WpMJLQyWeZzuASa1EvcabcJqRQcqLQQISRBNi8
cYk1ctOT+OpwaqrIba40IKG8ho/PnHhlQupT9eRz1s9w4s2kWtni1pEtmXbLqMxIbLahc+/VqBXE
cQspLPLWklm5dcqzsdnfmt7xaRLQw3Uihg3/++RAAAAMtlRPa1pjbrMsCd1nKW2VKUs/rOUtsqMu
ZzWcpbbZFS6zOWyJJuyl84QYViqCIRBQOchlwAMES1R6chMxZ8jVveWPofmWKwXUstinp5utDlfm
EdAADMvGBRZGmLRWazn7z8R208EDypLN96J5pfVUfsNlUmCgnE5Qds0Oqunzw9kUeVD5jZcJdlJ4
obPSKNLwkp6Ff+f6XEnFJDUsyzEu2Yeq5iVRLsx21a5kruo485M2evdilrWttt2Xu9nptaazD0Pr
pTUhJY/sqT//////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
/////////////////2RUu1qdjaSbpiMAtytF9UEQibAelK6AKIR9QyVIswv08D6stUrEJJxUsDgi
QRyeuwHVv5zCjS0TvqBRTFb8hrbn8YYgmUX2PSweTceVzaPwkjgVKiw0aRMLr1LsSiRik6ywS00K
5KuZOshAHYCXEIDn1SdmZAMKAcColGYqniyWpp0QTD5jIJmmpqmHxJouQGoT1Zo7rTEmpbqybNIj
Mk68moTmjxKdZn2SvthXG92fuH1BtCntrk7ZG28WwlAwhFdAt8QIAelnj+F/m/T9TcRJRccNaSVT
S0GzBghqO8jFaKs2t77itOBDEtTYnLWP6x3MzeUvxvOhRYBFCzAKCeDaAKkoLEgoUODRwNCITg0P
NlFxOowGS6CDg+QGhC1ISyB4/OxRJuILISxmCfEbTbOFW5kzQrCKrLC90o8y1naaQppoFSh6pso2
F8pC01DForTlDE7WKBQrYcdAVdrCdutLkbSTsxMteXbwEgk9A9VkDuF/mnqndYOBfyX1kJw4CFyQ
rIr6OxOWXJA213+4xuCTQnSRgWLXv+rnEZu5J8Y7AGdUIxZVDBph5CSs0oSLKFhETLHx5o1B48k4
lQsMeYOBoK0yZoiJppiDY4IprYw5MPqH2cOtTa0qBMYoCrWU8lItkKmiWytQWyUo7HWaZPopVJVb
0l73oWKWrXfopwxmNSpqIzD/++RAAAAOJDzN6zpi7oln6b1nLF3UIXEzjOkturOppvWcpbaxFO62
uSJolSt0VhUAidjfCL4tCwll63ww9N5WSAkki4wwAaXQFgaCCq9JVGX3wpKKir2ehg0hBGTmBjBx
4dx12gltrK3Hz8BKmtaP/TOZMVNL/81tk/+zmact49qt5Cy9oE65qzl32kb0OMedLF/TZxys5XMg
whgrYN4EHpAD62px/8927X3vX+/TC+9fz///////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////tZT1trUiaJ
V2ZGiC1g4Ai0Ftgz1pb9qiGgxgItQpUuZ6FtOW0gqClx4FjV2vc5S4Z3rqZhcI/cAwivj+v/a68b
S5cAKirXtvjFamKmkM7PWz732Zm5ivXLrPLmv3IL2a+j77R/G3lLGTn3taJZl7d8wZNpc5oPvQr9
FB25U7/3rz9iHvc/d7e/+VoF22y/pWf5sKJyNPo/isAsunlcdcMSYiXcUuYcTA054w4aTwCiJit8
1DVPXktDuvcRuBBI2EMWYu1V5WyoZ612frbgx5rdg4TmaXJjCPXnzjCAmliZte0Flb0grm1OKsRl
DqC25m7JFjjU0ZzNKBlyFHIgJZsfXqQVj5Ptdtmd5FLsbO28pi6T2aUKhaT43cE6hsq8f9qVR8Z7
Dxxvw7b7YynbbUpG0kp+DS4xe1mQVHHdDXDEgrSSaESbr6J5TSP7c7FJPiWr1yN8qCbmX9ffue2Z
IuAu0HA034f9XOVRKnoKWAmbUcZEBoWRisTxE+ridAQBgTOU1YLkA4mNqIiQVSN0fA5gLgINrB8f
iT4BDQHNE6ZxQ8IACkjJGiFBKmylIneoS5FEjiR2YR5fWUUPpwbIFjFad0nOIMUL6+FRgnBBOSWV
ETRhJxr4xKz/++RAAAANxFpOazhLbqnrKc1nDG3URVk7rOktul2mpzWcpbbVhPa2lyNpJvstRCBJ
csBipKqwHHbrJUl36UBW2vx41cL5VXdcVMBMoGWKatZ26Uv3hh77nPw+exP/SdpaPPLVLKoy5kz1
hcgLqIYjB9E2QoEKocwLChdc2fIyJlyqNguaJFxglWDVGofkB1SbbOzKNrokJth6REjWhM4bJIop
CEy07UyCMyd6NKTWs62ojSSjJaFFNOQYRwxNpd2v660/s1JdK8c0NsajA///////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////1gLt2pUjaSbbMlTpQkiMUhFVuCX6ehSlhUset+
Phl4UQ0Myw40OD4Rt/qClyZVR75qglx54UL73essb9emj1uestWoadYnWH6EyyKjp5WicORJUsBM
VGVJb9emd4qm6E6rPENI7K5fbGny46spuLqrniSzCbwI0y6OiiNIqUXTPHKn1jbaTX/eh95H9NvZ
HA1/tf1GsxhexRv23bRzdq8t3tlmrwJgoT8ferKl21TkbSTdh9jJVEASU5b0lBPchu8bCDVqDoLW
G5q9R8gOaDBIhDHLGGFAxl7c6kdjNjuOE3KjMO13xmmud5QW8bV29rUbmtdUPIRCytryFhcsQqIV
BSwYaFRuGEyzkskhonYc8hslVolJoRVajGjURSzu9eU8ULqpa5tZhJHq6VzWpNM1Uo2lsIx9bcZa
147srnCql31HbYhXsR4LljsVu1lO26lyNpJTtEBTS8iZaKpKefaSlbziwqzB0NiDGXQfzvuyz49+
Sy8vb2b7K4Z3+PIIyAj7jO7GsO40FvOXU1yglEDzV9ZUDkJDiLrkLC40S1MgJVmJCpuDiZEYSYtm
SPmWo2SparTC9mu5YmsUs/bnqkHLlVJObWJKXb2UGvC7Rfx8P4x9tvVymtFwaJjhQmKsAF+JVdL/
++RAAAAPfUTMezli6oTIGY9jKF1TTS03rOUtujSmZ3WcjbeXMUSpmIl/2tlp3nZKIQK4jEEOYWKZ
Y0xClOAtchevKQKRZy8iqo4OdyDkUlFSXbk/2/fzp3MNuQwBqbHetzeMdNToYhhEbTRzG3momrwM
F5TSJ49R9JLdparb/xt2per7CGsWLGfYhQrqrLOi2N9SctWfrHiy8GZF985te2o2KYq4v0XohK/C
Th8Sq9G/2v1p0oq3f5n/////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///////////////////////8sYItTUPJ9dZLH3miohB5bosZA5C9DuBgVWqmDAxkBjKnDS1SIyod
zqigLDDmP9321t83UMkgMUy5//vlo5ZIKwDBEMiplrWF2ZY7W/F1/lby4Q8bYoKikUp2IKDTmMKG
WcwiiCcU5OyWkMvxVyo4EkqvcUpKOm1MOcKmIb/e9+xkhKe/dkBlttLkbSKhm+9KAdUIkGpSHmR3
gMCclqjAWSNdkdKpUv9Aw9RkDIahqzAl2XRn/+zUEwQxOH90uVmWWbU7Uh+PzTFPvkGdklDLBtU6
Fg1MNPQHY8qZF3pskIqfDGnry0lcgyApRRG+iKrDyNXD9hYq66RIkDGoytEHWZXkvTVqrN3FchNe
X/jHd7/IBsLbuUV3oyd79P/lmJroXdtapI2knKel5EBKYheqBB+BOmHCASH4pLU6Vqu4y1bSZwOA
A4yiE9cxouWsf58VeIDmAod18aXOzLKt+zqvvKDt2wQgjAVIODrCnAnGuyjAY4UOrGWCFm4sKyCT
CjqBowNhzuKQCcjjBEJ3BmIoIS9uZWOROFH2dtaY5HsNFpTCrEEMug6nfZXn8/r/++RAAAAP/EzN
azlLbrYI6V9nJm1NnGcx7OcpKeWb5b2ctW2xhS22KSJklU08rwLglzESywENguQ9RhhIVqgbMWZV
8vtSyCnjWMNwpQt6/PfvU1rDlZRwQqHeOKiLWkNHKHCjVaV9yvYO01ulvExw3IMoD6QqPm5fELMP
KXqukJ2Jol2As0URkqGZlCgWi5r5tw1ndT24uuE1fssqMqj9yOQry9Py/meMfdzjFKYVasXsWle/
UuLv82b/////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////94QUaIh3etkbbjVOhgvdBAmMFajUDLQNyGghYMiIlCCq
ayyWIS191KjubfJ7Zbap5qHreGM0qkQqHe2QEO9O2q0SlVrPPvN00bxxo5OCMLitSJTxuM1HfYc6
1dLZJMUmbL5kV8vEdmEppxNs839vXqf6rH2PDbpzpbktikoMTxJUP3M1p/7y/l/dr///////////
///////////////////////////////////////////////5hRNZqqi362SCXMwLUpfoB0ahmoyz
7UfQvWc0VjwcOtJNdNcuWwUeIOEYeFh+zP3+Y2c/9YJSo0qAhPWG9739Nn3fcXeDiHrbPFKOeXUo
3UhjCBDkaSMdUP5xOH/P/eebdXx63redbjg41gx7MQgG8vEvJrI2xPOABATBHR/C4AjEAa7rtfEh
0rgoCsMg/m//YnFEiDlmdWL3Z/v8nd60m0oobGQAEeutcyNz5m8eSaSDosy7prRNDzLeyZm04paa
aVF1KRQZtOgs4plufSWpSClpmbPOX55tTvnHet15jWw41wjebWj/++RAAAAP+UjM+zozao2JyT1n
Jm0QaUcr7OTNojAn5X2cmbSZYTipqYn/2tt22ASCEQIiBT0FSgW0Dm4yq0ssh6/zIpdLXKeONAEM
cRqPCnkjG+Zbx5h7Y2RmvQqVSDKrSU9nfLGNvPcJx8pIvcCjzSnUdGg5ZNj3zaoaQVsXq7hLlzVw
fe30GLQqDEonb2z/3bMxtlrmaY/NWzM/m9nDfAUm2maUuEH+1/p3/bc3////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////2oGf7UuRtJLckRHR3RBLyNLNOQFPxUoFYIje7a6mROm3KfwUGNqtRmMQ
53Xf5zXu2xs6aVbL3bPLd38bG+18+d4KJSdyUyQrnRYOfsPTWsoJiUnvfcLw9FPYnVvhCDyFQy/e
7tH62zMR08rvPg+rHGPF+b7yb3ifHezoEhNxwJLEqnnMclf/V///////+yoINEQrKWyNt/HkPVBV
NR4siLEyks6EDAqOpEL5ZfCWRstiygrGDHqklDfr57qzv3vvKHnQphIP7lrmXO1KKl22/OG1hsIq
LQ5bDH1Iq+9XTyyCbrt6d5pbGDvtnTuX9l3R3xD1JVY8blMmcdyqNzK/ivrfPT99mr37O43bUwy/
mXfUyoJvERDK2yNt8tF9VqstDi0JZSyTByhNFAWgEYfEXST/ZTDylL6GX8nU4MXv5516L7O39YGd
yjk2Pn8qmEu33WNmu/dnptaCoIw5mmwETaR1cvdpNz4TL9llSnOplCEzk3JfZqLR20WRMZ2NMSm2
3KZNKsbS8ypyM++PS21/nt/3dTPNnHnrFuauqpL/++RAAAAP+SBIaznKQqgGyT1nL1sPrQUlrOUL
qdyWZb2cvW1xg22tySNtsb2oGDjBgBAIKHgNNCpHEu6p2vCCk1pfDUUkfGCgmtgN3esvx3cldA8Q
EJPW9BNGe4ZY8u5d53LB/Oa3hl3HlbDDUzNwQcqGyWDr6qxa5sBY+TTJO/5wWTrRbP7K2+2v+//z
Pv//////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////3su/b12RtEjd1MctYo0gqKBG/CXCUJDG1vssbkjc7eENWpQ7Bmjpex3eu73hlXuPs8p5
lgHSlnkhVgS23rPiwtYvS162fYgeDqtNwIvxrdYOKPrT/XzrMLUG9s41PSLFxfVM+sSGGha1Bndr
IofcuL1OX1//////////////////////////////////////////////////////////////////
////2orXaVWRokqvNCQjVX+JQwZWJXDwCYY4CXgldLYdFrldkjOkpDOkU/KrE3Sc7rPDCVKqnoUC
A3apNUMvrUlINHoUA2ZktT4YyD5U84weq3KyPEsnLvvu8xXMco1TVX33b2fBm12jNCol2jRIz3Ix
Y8Zq9V3d3IB+/9uyvvvHdRR4eIa/axti3SNWLcsIIASwWD+mCInoIWxNDldetDl5vXiegs41J2pb
Xw1/7vWVUEbT6LADJpP8Q47dEm1B3iEnYucZmnjbdZj3izx5ryy73XMeHSFnP3fcuc4mkhTBPq+N
3tBxcT/NrUcraFW3Z39+1vfx/rj/++RAAAAP+kdJ6zlLapGoyU9nKG1QWP0nrOWLqiCfZLWcpXXS
G/73KWNtJU8kQqDh4KEA5VVOUFHQuuXmQmigaIEqqvY1R5GlDoBl0rPq2Z+Ys2p3LvrLfo8SgiKg
sUt6h1TSiZjFu3XeanqyYWTk/F5wI4O+3qGUooOkweQ0+pQluH7gmlurGpsErAmQQZJEBBsyitsT
wkm14ZOUdlGc5ZXhC7plKMZacWAHwp+ItP/2X3d2u/t6o///////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////2dxV
nd4Zy1xpOnpFXBC6D6A0qUkU6KK008Q4leaNkZelzYCgV6FDjCpGk47Lc9Waad1b2tNYYyfCtGHr
GNnPdqtZpM87sDV66IcTsYe5gdpXL6t5nA4UFWtGUi8LUjiBFlFMOFUOFBhooKCjjRiyKcGSd1Tt
O8zUJ9JT2bTOtmwYfw9pjS3cmX333N+29f////98Mu2ldsbSKz2OBIcnLLOkNJjlHmWmqWtUYo19
SyfgF3L8dacYUkitX8bFDRYZYdbRnJmcprr1t1d47pDqp1fTEYPNxZaj23ffrRyz/vTa1uipHdn9
pW2f00vfWcYvLX9/Vve7y6cez+nNY7pvXpfeeCD6JX9Yb+X/KY6+17OLe1l1NLQtdbU5G0Sr+l7k
JSAtEQllLwCyb8hQEaBjVW1KYiyC9AdGI6sJFblNiZnd6y97JCY/Iss4usd/dwLMkS8EIs3cUlnS
m22+KiDUeNXJYiphAfXVnGC+w9wUXTgh6k8Oag+Mo7Xki9NIJwTq0sz73WvDxA3yDw3ATWxreRFx
mybTs3f0qiW5+5T/++RAAAAP+TbKezma2JyHaT1jJl0PRN8fjGpLQhkh4/WdIXFoMEdnZ1tsbSQ3
fGghkNaAQOnqLiIOtuGEMpjdmvPN3iNilpjrbVZQ3v1/d44TxKMMCi24IwEONklGxmo3UmgmsvqR
UgpVnRzjrQW1kWqQVSVs6me7VItdNBlugi9TImyDEcJHloCUydUUYlJ5LXlboVV/////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////3wLbX2SRtIq/bTFQ
PcQO+k+U9QNi75XWt3o7BTcZTuziBb2rVbPMMb9fG5PJPDg5malDMqt6zyz0Pjc20jPEVVRWRyrL
w2PmS0ZWHFFsrWff3qsrd2PlQi1MhK6RlHOxxpwOCxBAoSCps8EEXx6ft0urWov/////////////
/////////////////////////////////////////GwZZY7/+qo2ElAs9AUAQlSRmyiTMkQnGS4e
1g9LC5fCHwQTGmDoH5fnYv/nrDCFRc3kAC7l5nNUC6fZZuggmUEThcSWcWbujLk+ZLRdOgkikpBZ
83TNUFJq2OKZSSLG66KnQXTbN1CjE3Gt4nFQ+KtT6GBw4U9feqqqRmWu2FuNttVHpFRHcLACFZAY
bsJECmuW2gdYjysTuz1+Qwwj0ZYkknKqtuWT9JX1+DxT5koRELi17WPKs8juluKEkA0FiwkFRHdV
DiGiSR5a00ttI89xFHQ4+XxCuRjSOudUu9XM6F4i4ru+puripb3gtzs7g5WpVlYwYYQ2Y1V337/D
7/z/++RAAAAP/DtJaxky6t0kCQ1nFEhMSHcnrOaJIXMLZDWMZSC5lbbaKuJElcmUbRYD8hBAa4+s
H9sdTRUmz+bdtpdM8cWfVCQdMCZ2VJzXd583UYyloc96CaJya/LZVLqO8aK4nvjhJG7PmDV5deMz
s1fX95LTq6/jMxLa7uUk1Z8u7be81y26iG6VlYfASvamqe4ljfpXrOytv3rn8/nP////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////+Vhyy1qtttt41XNEQEOhhhcIhkJ3
0YR5rL3FdF37VuV0cpVIcQ0c9xqaNlmBTFkAZ1iBY0QFBM1Jo+VlrWpJFbMqit03qRP5tKa4cFGo
ZJxmlFX94UGSTl2ics6FWlCZCIXktfl4j1P7N1frt47tvXHffn//////////////////////////
////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////+9J331dkSJIxetrwYEmOIxQKQdqZdJ6S2apl2
u82kGxmOu667IjEpc/ls46R5necIuBolwfKTzqdAzMmapJIrpILRQTNKRYaiUi16UVgmeY6IhjLH
kWKS9rSbDT3tN3yXKdUtD1lrUbbbQxgtpQ89FNJ0Q2PEy1SgIGOnU4tuZn5NdiMNwUbmsf3f1nlz
nc8rkGmxQiPLuayw5f44sbDhIInAEMUaqMidmJSjQGeY1DHMQw8kVUZfOieuaab5L0D/++RAAAAP
+y/LezmC2rgmCU9nLVtOXPkfjOTLgcYb5PWcwWx4UDeHiGe1tbbylKKAjCCoYdrIQ0ZC/YQCx1dy
gUHX79Vsr8wOSRPPHbWv53PWW90pwwgFhaMGeXE6zOmmXGRZaRqta6ClXZI1LiJYJs3QQQQM1pIu
gibKMDE+pTnT7/UknOHrvvLKRD2zz4DJ8mef4Zuk/3D+cdQz////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////7OwFDuzqrI2klWiKlBe8RknQCOBB86UfHjCBoCda
ca/Lo/Bsh4KpS6U2v1y1nrLeErOF0ANBGMmZRIJZm61qZbLUa+pW6kkUGSTdkFU1pJpqZTqWm1SZ
9zFmEK54cmxXDEk6+auSk+7vP/781/Pf5n2vz///////////////////////////////////////
//////////////////////////////////////////////////////dRUklb//1y6g8ChBCGnEI5
xk4mFZeiIqGw9MxFHUlkqd7htxy+tKcu/N2fxzmG3NCwwA6XLHuUkvxV285tek9dU8nkeNkZNQtF
2iFfUOheRT+He0DPZ/1ZK4ami7fWZWS+ayWLWSgigISWS1uItuS2hv07Qzbb1txtEqpSt+KAIc04
xGOeozuuONErhh2UNghyQUk092Bkou7as6392z2zm0RpZwRAFpr0iw6F3o9JA3RWeRWmi1B0TyLq
mq3sVboOydRktaVJM8gjTSuk7LcwUdTaInUkXDUUHUEFu3JlW29l3E7/++RAAAAP+zZJaxmS2MWH
aRxnI11L+McdrOWrSd0cJPWcvWy2F3bayNtEk5VkzAgCuCA5YufkhhVvotrNYk15s8Vl8PU7aNbV
YvadwwwyrbuW6SHl8HeOBMjc8i6KZ5JNLWs3dBFLWlRoqKx1knSc2RpmBkmx9FbpLXetbpLWgapL
rWp1JHhGkMh48eAoup5JYGbkxATINFEFnWfV////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////8sDuls/6UOVlmIKQ4ShksIYSXFbO+aBJvmdMXxt3/fx/3Jca9hhr
LuOs6SBkwDFwHkpdzmef3jdjYPRWi/DhqRAhVrHKyngo6tXMU9p53a6CZTe5yDR9kPQEpyW/GwVt
fF3+tP//////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////+4gm5Io0kkgOwUuYg
CHggsCYkZrIIxsKMAxbr96kT/OrHLUOMMQKdSn3jvvPv2o+8ZfwK9gpA4UkTqabJu1loKqe6tq7K
V09TrpJ7oOkpT991Knn8IE1AGsed7u3S+/uV8Mu21dkbRK3NLwc1V6AkLNnUIxJhAACXDG6ePZRm
appDKFHIpT8q3c7OffuwG9hqzgVDJZosO7fvNpvWDEtbG/unvm+fqlMa8feKbvW165w83GtjH+9/
7geI6380xJNf4pWCXDpRrRddM+VYty+9ph3Qipjr6db/++RAAAAP+xvJ61nKSrgHiW9nJl1NjMcl
rOWrad+b5TWcvWzdmXbe2yNkkSqosAgqm2jOsIcwqJKFyhwdpqj0U9+Txj4m1gZvl8Tl+8Ktu9rC
0jwAhgnUHQtOlPcblLa7hnj+PNdue8eHPSdmMgLStF80YH48jzfycer+9HP5vr72+oh+su+47/97
9///////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////7ugI8PEPLtbG5LsEdk6WxoEYgBwRoyKiwbJ1bIxE4hKsLjhuwSp9jdu7jQxed1h2
MNeD4QcjD1L+7lnKhi0eaiyyp3npplV3VppaOUlGqhZ5xM3ScXAX9tcPDYlVmKozZRTVy7fDp3yZ
27k0kMJKSGxAjYhNfWx6rg7v8z/23O/9+1//////////////////////////////////////////
//////////////////////////////MzLdtXG0iSLHqnUbLmrADBhS0UEMHBwScc3RTEZhUDxCeb
IKYTktmrWVW3vXait0pO3oADxBSdzdE5rTTWtadN17sya2W61VoKuugylpMmg93szUFpnE0cPj+2
Kt1PE1KyZu/71Ef812sP1/N6Zfv87I4klhVX2+yDKJhAQC21QtfHinOiMhh7KTz0Ypn8KsEHTtB2
mq26+Wen+hB31AJ002MOdYX+b7rmDn33r03rOYNc+HjOdfVs0rEpm1IbyN923Ws31LuS+c6znF8a
vJkKvCw9wAJkBO5rjbRt7jhJWSIWV0D/++RAAAAP+RPJazjJywukuV9nNEsJUFUjrOMnIRmKJHWX
5OCame26KNpEkfxqjQ2xloQUOL1IDnHFBpgaootT3LT+0WRr3slrWufrWW8twW0s1uWovbajkEUk
vEhy1IFo8CwCSIrgX+us/esvewq2PE3HwtbBXf/PG79fg3yn8/g3/3h/////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
rDikOzwz1kaSH8iBUDLLtMLVhrzBn/AgKNEWpI3Y7qHZb5q3slns//LC0t0SVFdAxy0N8FtKyK0D
iKRxr2TQfZS2fWtBTqUyCzFEoFQ0UWNutaw7WoDKeInl0OP8jn2CKxJr////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////nxVtuiiRIAHaQhlMdlFx5yq
ydKZEN5wuOMS1/K9WZms4w9BvAL/is9zncMsf1KVPgyxGWFWcrGInQ+6oiXXdGHKqXPmBPGUTt9a
JaZpbnK22wB9RP1Ksuw1QgvBw4CG5gP42pnW4zbTKgSRsDN/Vv8/9d3zUAsWBGxZWBrNoIjRJ0qT
rOquMKvMvhhKlLJIb1j/++RAAAAP+xZJ6zjJyRaCWP1l+TkIcEsprOMnIQoK5TWX5OS7B7XeSxpE
gb6muXZChyfAw2HtNPfsiIwSHWiRe5e1IYCdo61EsN8//3zvcLa6DDxLVVcua5hfE5E28MkFKpGQ
+h6HtOOxqx8lNotyLZytzDVdP///////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////7rDskiiJAAAx
6nWiQFgmlACk0QiwnWBEC5RqIV7+C2RV0cwlU1b9f/753OYX2xQ4c05gkpD7Df5qX8XKdEN/////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////fS99/dY2wQPyQmpvsiRa
KjILYZrwWSkivbU1MSzOHpBKTUpffVv/1/c8rdIXrFGVchUIir6ySqlO2oO2TantXsL//XfhPtvd
Y2wAPydUhBUyBwbRyuAVDcG6bpxSyvJtPmiCaCbv5Z973P8799uLTzSrTVy3h+ronaskqq5qmodY
osrWyxL/++RAAAAP+hNJay/JyRbiWNxh+TgHtE8frL6HAR+KJHWX0OCaia3ZyJIAAfXU3IAR0Vf6
tgDNBOIcB7Mp62wGvF1YtlkQ2Ptnvv/r92MbbPhDYs/ZkGvP/eAFb2o/////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////3EHGnFUqgWptqYiKQDXmCOGL
oGtOArhhNsFTR/Hoq0gCaIAt45a/Du+cpmeAW5V5oHkoC4ZaXxeTQ7duWnc+jlq0f///////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////uwqySqNJIADK6mYIE2gioBhSHOSAJDKA
Yw0zhc39nFhgrtDwDVJBT9/ssU9wMGdFLFVNxZqXDmaP9dXsCaJoJbLXI222Bli2qTshIAEJhXaA
HDWKN+jWaXNXuV2nwmXJlK6XdBY1x9gYNiLmKp9nBVho2EKpx1R59pJr2biZUm5TbEf/r0D/++RA
AAAP+RNI6zjJyPbiiLll+TgJjFMnrL8nIWaLI7WcZOCbB6y5xhEAAaxLxq3FsGpJ/A9MWTQBcKm0
3F9Y26laxTGApA32v/9fjjnBNEdjyg98IQL9VjRWz0//////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////nj06wAAf4jDXMpojMjOJrgIqGEFNBTq9ybH0
C01gYozbO1+OsuY83VqnA0iHPXqzgZtjY55FtwUI006XPrfxVj9Bj///////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////7sJ/rpa2kSB
dxoXQV+YTBCeElEjDTUoDgOI5DvYUe672ZHOphjz/5+GeqqqB2mlwrPb2YfCL6GsA4o1UYaigHiZ
ssc5uJMpufat1OKKQSRpqNJJIjeMAusuoRDDk4BCQSjR2WM0ZdYjOMXvfjxi8s1jzDXP1nUjrDBP
4IK5le33KwTrCIWSDwq9jUuAAjfCtAMWrNpWCLZxxARwu9Em9jRAQleyp2n/++RAAAAP+RLJ6zjJ
yRviWSxnGTlIaE8r7OKHIPWJ5HGcUOS/GbXa2NpEkY5q2pyM5CARG2cBicDjCyERblp+rd/V6NQC
8L/83h/1sd3LfBCCb0qzTl72nxe1tS7m+t7FPL7hyqlpT2J2pqaRXkbPv0f/////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////z4zWXX/pU/r6hYZTAu6IRQHAPEfZQBq2q89vvOWpSqrDeN3D
epVv9djjpmha1Z3X3vXFfPd0TPbNyhir6VvhDQf/9/LVFeS3lN3/Gb7/j7fb5eymv/fD9fr/////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////9XYUh2d1tkbSA14wArG4JbltQfCrDKAcZmMUme3OdmqGUhbYyS
foum0jw64GFWDOmzFhYix3cX1P6q0UpTS7yvoilapoHpLX9KAa6loqJ+QoCuQBqqelAk5reGedB+
FahiIRAHEn6N1KL5HgGshWpPIvPkWOTUteyjVYh9iWk/lVD/++RAAAAP+xNG4zhpwVMCeNxl7TkE
kEkXLD5myJMJIuWHzNhSNxpM8gAHdSQMCTBRhMUo8WQKRxy0ya8M01Nq9h+5aBDl232sLoGkegbx
RPLdrDP/////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////5kLjSYkAAO+9SYSZKfCww22BuL+HESdhZrXmvnL0B3kr/aiPoVEBlAqjVIWj
sl//////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////5dyqQAAH6j0ibsIQD+jq4M1gP+zhi+ItVubFwl2V/kAFygCRSl/KpAAAf+cDM4EI
g34jYJCWI53Cl7010XPjwSVX15ACGgYOo1D/++RAAAAP+hNFyy1pwVYCaMll8jgEiE0ZbL2nIIoJ
o2WVyOAtlCIAAD9SR4k9mPCBETLAAvDwQK2MmWruAbRov9scQlgJ8UH/////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////z+1Y0AAP+ULyWCfoyjzpHAjJVnV9L/evj7DVx5f/IEOYBXi0+v//////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////w2oyShAH+/T8UiUBLeEPAeBSjhZL/OvqmsAwr/2j6MYBrjaql++GNQAD/k9i4oSKrh6Q6ByD
JMXa/+KxQq/62kaUAQyVf43/++RAAAAP/BNGSy2RwWBiaMhlUjkDvEsXjB2nAHkJYzGDtOB59SJA
AD9xSUROiBB5SSANVQ7RgV7L8Rgf/9EgARozf///////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////9u9WIA7u
k9w2gGBGPiAUTQuQLbWrsLQ6/3VkwDTi+l//////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////4ShIAQgAAP+VVZ5uhneKvDcSvW14K+yv9yIaAAnMgnEiChIAAf9BKadowXCD8hMw2NNX7o
I3f/eaAC2Pb/++RAAAAP/BLG4yVRwWRiWMxk6jgDhEsbh6jnAG8JIzEjtNkNRpEISAAH/HqaSbV8
ZkACB4VRzL+BY//nHgkW////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////8IxIgEQAAH/WtZbBqR4C
BIUNJ0/ix/+eAFLf////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////+
VI2AUJAAD/LgQI6giAHUFIsBaHf3w23/ZhwRjQXEgCRAAAa2GOHOARAHciQWDxd/VN2/9ZcBwCz/
++RAAAAP+RLG4yc5wWwiWMhkpzgDGEsdiRznAF6JY7EhHOApxogoSAAH7rZR6NMfK5wWs6J/cHL/
+iiUd///////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////rcgpgH77qammbB6wAlp/nI6/6wLkv///
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////8KV
tAISAAGek+M6J/AMgJi5pFf8Lf/RANYJ1sAISAAGeYvlEMvgeMKHGG/49/+4ArD/++RAAAAP+RJF
wgdRsXwCSLhMpzYB3EkYgoTm4EcJI2zQnNwXkBIA01lk6IzAbQdCw7/xVb/8JX//////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////i8gBAGms6mgAfEDCg8//N/+sBX//////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////+CUSCCMrRUgAKXr5T/+C0IxIAEQBoo2A3BxjGJ/9P/4CT/++RAAAAP+hJGIQIpuXsCSMQ0
JTcCSEkbZ4Sm4D0JI1DQiNwFJAAEfNlUDrhX/+f/6wG/////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////wUyAABu5kkM4A3Df///6BL//////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////8JREAEQ
B/Wu5BHwPY1X/b/9ABBURABHacAa4Sww1/1//hT/++RAAAAP/ARFoAN4EX9giMQAOAMB0BUWgOBC
QDkCo1AMGEwAskAAXocP0BwPhj1flv//////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////8FQIAAGYRqqhLIY9X///////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////+AmgAAO6tPDJO
gQIZ6f0AKNAAjdduA3UIgO+X/KD/++RAAAAP+wRGWAF4EYNiSNtAIjYBmBUYgLzCQDCCo1AMCEwA
woAAQBmYfQKkwHf/g3//////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////4ChQ
AIgD1ohDB++J/9v/4f//////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////BLQAAGSpkjRNh2//oBU
RAAGsVghYw//6ED/++RAAAAP+QRFoAF4EYrgiOgADwIBNBMWgCQCYCECYxAEhE0AMAAAXqYHW/6P
y3//////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////gaABAFy1//lv////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////8AoAAAVAQgGR9ABRIAA8Do
0aj/++RAAAAP+QBGIAAACZygCMQAAAEAAAEuAAAAIAAAJcAAAAQAEAAAdf//////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////gAgAADo/////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////z/++RAAAAP
/ABLgAAACZyACXAAAAEAAAEuAAAAIAAAJcAAAAT/////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////9UQUcAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAyMDI1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
`;