console.log("Mods loaded...");

let drawbot;
let drawgame;
let copier;



/*
TODO:

implement a UI for drawbot


*/


const startButton = document.getElementById("startButton");
if (startButton) {
    startButton.click();
}

function handleRoomConnected() {

    console.log("Room connected");

    window.room.board.changeSize(1920, 2160);
    drawbot = new Drawbot();
    drawgame = new Drawgame(0, 1920, 0, 1080);
    copier = new Copier();

    window.socket.ws.onmessage = function(message) {
        messageHandler(message);
        window.socket.receive(message);
    }

};

function handleRoomDisconnected() {
    console.log("Leaving room");
};

function setupInterception() {
    if (window.room) {
        console.log("Console loaded");

        window.socket.ws.onmessage = function(message) {
            messageHandler(message);
            window.socket.receive(message);
        }
        //Custom css variables defined at the bottom
        const cssContent = customCss;

        // Create a data URI
        const dataUri = 'data:text/css;charset=utf-8,' + encodeURIComponent(cssContent);
        
        // Update the link tag
        $("head link[name='currentTheme']").attr("href", dataUri);


        const originalSetConnected = window.room.setConnected;
        window.room.setConnected = function(isConnected) {
            if (isConnected) {
                handleRoomConnected();
            } else {
                handleRoomDisconnected();
            }
            // Execute original function
            originalSetConnected.call(this, isConnected);
        };
    } else {
        setTimeout(setupInterception, 100);
    }
};

setupInterception();

function messageHandler(message) {
    let json = (JSON.parse(decryptMessage(message.data, socket.encryption)));
    if (copier) {
        copier.receive(json);
    }
}


class actionHandler {
    constructor(message) {
        this.message = message
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
    constructor() {
        this.active = false;
        this.user = "";
        this.mirrorX = false;
        this.mirrorY = false;
        this.xOffset = 0;
        this.yOffset = 0;
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
    receive(message) {
        switch (message.command) {
            case 'INTHEROOM':
                break
            case 'BROADCAST':
                if (this.active && message.from === this.user) {
                    drawbot.copyAction(message);
                }
                break
            case 'IMG':
                // In order to mirror this, I will need to be able to press the flip button
                // As well as incorporate the width and height into the mirror equation
                break
            case 'JOINED':
                console.log(`User ${message.from} joined.`);
                break
            case 'RELOGGED':
                console.log(`USER ${message.beforeusername} changed name to ${message.afterusername}`)
            case 'LEFT':
                console.log(`User ${message.from} left.`);
                break
            case 'CHATMSG':
                if (message.message.split("")[0] === "!") {
                    this.handleCommand(message.message, message.from, message.chattype || "room");
                    console.log("Action: ", message.message);
                }
                console.log("Received chat message: ", message);
                break
            case 'YOULEFT':
                break
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

                // --- Simple Key/Code Actions ---
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




const customCss = `
    :root, [data-bs-theme=D] {
        --bs-gray: #95a5a6;
        --bs-gray-dark: #2c3e50;
        --bs-gray-100: #10171e;
        --bs-gray-200: #2c3e50;
        --bs-gray-300: #17232f;
        --bs-gray-400: #1e272e;
        --bs-gray-500: #212829ff;
        --bs-gray-600: #283435ff;
        --bs-gray-700: #566573;
        --bs-gray-800: #34495e;
        --bs-gray-900: #2c3e50;
        --bs-primary: #ff8c42;
        --bs-secondary: #566573;
        --bs-success: #2ecc71;
        --bs-danger: #e74c3c;
        --bs-white: #fff;
        --bs-primary-text-emphasis: #ffb885;
        --bs-secondary-text-emphasis: #95a5a6;
        --bs-primary-bg-subtle: #24333aff; 
        --bs-primary-bg: #34495fff; 
        --bs-primary-border-subtle: #994d1f;
        --bs-body-color: #ecf0f1;
        --bs-body-bg: #1a1a1a;
        --bs-emphasis-color: #fff;
        --bs-secondary-bg: #2c3e50;
        --bs-tertiary-bg: #1a2631ff;
        --bs-heading-color: #ff8c42;
        --bs-link-color: #ff8c42;
        --bs-link-hover-color: #ffb885;
        --bs-border-color: #212e3bff;
        --bs-form-invalid-color: #e74c3c;
        --bs-form-invalid-border-color: #e74c3c;
    }

    tr.someoneelse > td {
        font-weight: 200;
    }
    tr.someoneelse > td.rankFM{
        color: #2bd3e6ff !important;
    }
    tr.someoneelse > td.rankRM{
        color: #1db924ff !important;
    }
    tr.someoneelse > td.rankRO{
        color: #ff8725ff !important;
    }
    .rankRO{
        color:  #ff8725ff !important;
    }
    tr.someoneelse > td.rankLM{
        color: #5ea5e8; !important;
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
    #sidebar{
        background-color: var(--bs-tertiary-bg);
    }
    body {
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

    .headerBox {
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

    .dialogTitlebar {
        background-color: var(--bs-gray-700);
    }

    .dialogTitlebar.inactive {
        background-color: var(--bs-gray-800);
    }

    .dialog {
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

    .dialog .form-control {
        background-color: var(--bs-gray-400); 
        border: 1px solid var(--bs-border-color);
        color: var(--bs-body-color);
    }

    .dialog .form-control:focus {
        background-color: var(--bs-gray-400); 
        border: 1px solid var(--bs-primary);
        color: var(--bs-body-color);
    }

    .dialog > .form-control:disabled, .form-control[readonly] {
        background-color: var(--bs-gray-900);
        border: 1px solid var(--bs-border-color);
        color: var(--bs-gray);
    }

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

    #sidebar {
        background-color: var(--bs-tertiary-bg);
        color: var(--bs-body-color);
        border-left-color: var(--bs-border-color) !important;
    }

    .containerSidebar .containerFooter {
        background-color: var(--bs-tertiary-bg);
    }

    .boxBgContainer .containerContent {
        background-color: var(--bs-tertiary-bg);
    }

    .toolbar {
        background-color: var(--bs-secondary-bg);
    }

    .selectedTool {
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

    #userlistBox {
        background-color: transparent;
        color: var(--bs-body-color);
    }

    #userlistBox td {
        background-color: transparent;
        color: var(--bs-body-color);
    }

    #userlistBox tr:nth-child(2n) {
        background-color: var(--bs-secondary-bg);
    }

    #userlistBox tr:nth-child(odd) {
        background-color: var(--bs-primary-bg);
    }

    #userlistBox tr.selected {
        background-color: var(--bs-gray-700) !important;
    }

    #userlistBox tr:hover {
        background-color: var(--bs-gray-700) !important;
    }

    .layerPreview {
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

    .fmNumericInput.readOnly input {
        color: var(--bs-gray);
    }

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

    .fmCheckbox > .simpleBox {
        border-radius: 5px;
        border: 1px solid var(--bs-border-color);
    }

    .fmCheckbox:not(.readOnly) > .simpleBox {
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

    .fmTable {
        background-color: var(--bs-secondary-bg);
        color: var(--bs-body-color);
        border-collapse: collapse; 
        border: 1px solid var(--bs-border-color);
    }

    .fmTable td {
        background-color: transparent;
        color: var(--bs-body-color);
        border: 1px solid var(--bs-border-color);
    }

    .fmTable td a {
        color: var(--bs-link-color);
    }

    .fmTable th {
        background-color: var(--bs-gray-900);
        color: var(--bs-emphasis-color);
        border: 1px solid var(--bs-border-color);
    }
    .fmTable tr.selected{
        background-color: var(--bs-tertiary-bg) !important;
    }
    .fmTable tr:nth-child(2n) {
        background-color: var(--bs-secondary-bg) !important;
    }

    .fmTable tr:nth-child(odd) {
        background-color: var(--bs-primary-bg) !important;
    }

    .fmTable tr:hover {
        background-color: var(--bs-gray-700);
    }

    .fmTable tr.selected {
        background-color: var(--bs-primary-bg-subtle);
    }

    .headerTable {
        background-color: var(--bs-tertiary-bg);
        color: var(--bs-body-color);
    }
    s

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

    .customTooltip {
        background-color: var(--bs-gray-800);
        color: var(--bs-body-color);
    }

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

    kbd {
        background-color: var(--bs-gray-700);
        color: var(--bs-body-color);
    }

    fieldset {
        border-color: var(--bs-border-color);
    }


    .darkInput {
        background-color: var(--bs-gray-900);
        color: var(--bs-body-color);
        border-color: var(--bs-border-color);
}`;