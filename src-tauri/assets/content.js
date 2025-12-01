console.log("Mods loaded");

const handleRoomConnected = function() {

    window.room.board.changeSize(1920, 2160);
    
    window.socket.ws.onmessage = function(message){
            //Intercept any socket messages here
            window.socket.receive(message); 
        }
};
const handleRoomDisconnected = function() {    

};
const setupInterception = function() {
    if (window.room) {
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
