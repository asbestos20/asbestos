//dom stuff
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
canvas.width = 700;
canvas.height = 700;
const btnLeft = document.getElementById("left");
const btnRight = document.getElementById("right");
const btnGo = document.getElementById("go");

let fpsInterval, now, then, elapsed; //variables for animation loop
const keys = []; //holds all current keypresses
let zoom = 0.375;
const trackImg = new Image();
//data:image/png;base64,
const trackWidth = 3000; //ALL tracks must be 3000x3000 px!!!
let boatCam = true;
let collisionMap = [];
let trackData;
let iceFric = 0.997; //properties of ice vs "off road"
let iceAngFric = 0.99;
let grassFric = 0.9;
let grassAngFric = 0.9;
let checkpoints = [];
let startTime;
let startText = 0;
let state = "select"; //select, hold, drive
localStorage.setItem("time-killer", true);
let lastTime = null;
let tracks = [];
let currentTrack;
let trackIndex = 0;
let particles = []; // boat trail particles
let particleRate = 0;

//if (localStorage.getItem("time-killer")) localStorage.clear();

class Track { //easily add more tracks and store their records in localStorage
    constructor(name, x, y, angle, cpCount, source, image) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.cpCount = cpCount;
        this.source = source;
        this.bestTime = localStorage.getItem(this.name + "-bestTime");
        this.bestCp = JSON.parse(localStorage.getItem(this.name + "-bestCp"));
        this.image = new Image()
        this.image.src = image;
    }
}

function loadTracks() {
    tracks.push(new Track("Meadow Circuit", 429, 1232, Math.PI * 3 / 2, 10, meadowCircuit, "meadow-circuit.png"));
    tracks.push(new Track("Appleseed", 1218, 530, 0, 11, appleseed, "appleseed.png"));
    tracks.push(new Track("Flat Bee Freeway", 2554, 1633, Math.PI * 3 / 2, 11, flatBeeFreeway, "flat-bee-freeway.png"));
    tracks.push(new Track("Cosmic Filament", 663, 2500, Math.PI * 3 / 2, 14, cosmicFilament, "cosmic-filament.png"));
}
loadTracks();

function selectTrack() { //this triggers "onload" below when source is set
    currentTrack = tracks[trackIndex];
    trackImg.src = "data:image/png;base64," + currentTrack.source;
}

trackImg.onload = () => { //load track image in an invisible canvas and get the image data. Loaded as base64 string to avoid CORS
    const offCanvas = document.createElement("canvas");
    offCanvas.width = trackWidth;
    offCanvas.height = trackWidth;
    const offCtx = offCanvas.getContext("2d");
    offCtx.imageSmoothingEnabled = false;
    offCtx.drawImage(trackImg, 0, 0);
    trackData = offCtx.getImageData(0, 0, trackWidth, trackWidth);
    generateCollisionMap();
    console.log("loaded collision map");
}

function generateCollisionMap() { //get 2D list of terrain types based on rgb values of the track data
    for (let y = 0; y < trackWidth; y++) {
        let row = [];
        for (let x = 0; x < trackWidth; x++) {
            const index = (y * trackWidth + x) * 4;
            const r = trackData.data[index];
            const g = trackData.data[index + 1];
            const b = trackData.data[index + 2];

            if (r >= 85 && r <= 100 && g >= 250 && b >= 235 && b <= 245) { //ice
                row.push(1);
            } else if (r >= 250 && g >= 250 && b >= 250)  { //finish line
                row.push(2);
            } else if (r <= 5 && g >= 126 && g <= 137 && b >= 210 && b <= 220) { //checkpoint
                row.push(3);
            } else if (r < 10 && g < 10 && b < 10) { //void (reset)
                row.push(4);
            } else { // grass
                row.push(0);
            }
                
        }
        collisionMap.push(row);
    }
}

class Checkpoint {
    constructor(x, y, time) {
        this.x = x;
        this.y = y;
        this.radius = 300;
        this.time = time;
    }
}

class Boat {
    constructor() {
        this.width = 33;
        this.height = 25;
        this.angle = currentTrack.angle;
        this.angVel = 0;
        this.angAcc = Math.PI / 1300;
        this.xPos = currentTrack.x;
        this.yPos = currentTrack.y;
        this.xVel = 0;
        this.yVel = 0;
        this.acc = 0.042;
        this.maxSpeed = 5;
        this.maxAngVel = Math.PI / 30;
        this.fric = iceFric;
        this.angFric = iceAngFric;
    }
    update() {
        //change angular velocity
        if (keys["KeyA"]) (this.angVel >= -this.maxAngVel) ? this.angVel -= this.angAcc : this.angVel = -this.maxAngVel;
        if (keys["KeyD"]) (this.angVel <= this.maxAngVel) ? this.angVel += this.angAcc : this.angVel = this.maxAngVel;
        if (Math.abs(this.angVel) < Math.PI / 2000) this.angVel = 0; else this.angVel *= this.angFric; //angular friction
        //change translational velocity
        if (keys["KeyW"]) {
            this.xVel += this.acc * Math.cos(this.angle);
            this.yVel += this.acc * Math.sin(this.angle);
            let speed = Math.sqrt(this.xVel * this.xVel + this.yVel * this.yVel); //normalizing max speed
            if (speed > this.maxSpeed) {
                this.xVel *= this.maxSpeed / speed;
                this.yVel *= this.maxSpeed / speed;
            }
        }
        let speed = Math.sqrt(this.xVel * this.xVel + this.yVel * this.yVel); //translational friction
        if (speed < 0.01) {
            this.xVel = 0;
            this.yVel = 0;
        } else {
            this.ihat = this.xVel / speed; //normalize friction
            this.jhat = this.yVel / speed;
            speed *= this.fric;
            this.xVel = this.ihat * speed;
            this.yVel = this.jhat * speed;
        }

        //update rotation and position
        this.angle += this.angVel;
        this.xPos += this.xVel;
        this.yPos += this.yVel;

        //console.log(this.xPos + ", " + this.yPos);

        //update friction properties based on collisionMap. Treats boat as point-mass, not a rectangle. Marked with dot on screen.
        if (collisionMap[Math.floor(this.yPos)][Math.floor(this.xPos)] == 0) {
            this.fric = grassFric;
            this.angFric = grassAngFric;
        } else {
            this.fric = iceFric;
            this.angFric = iceAngFric;
        }
        //check for checkpoints, if one is found, add location to prevent re-checking
        if (collisionMap[Math.floor(this.yPos)][Math.floor(this.xPos)] == 3) {
            let newCp = true;
            for (let i = 0; i < checkpoints.length; i++) {
                if (Math.sqrt((this.xPos - checkpoints[i].x)**2 + (this.yPos - checkpoints[i].y)**2) < checkpoints[i].radius) {
                    newCp = false;
                }
            }
            if (newCp) { //add newly reached checkpoint, including the current time
                checkpoints.push(new Checkpoint(Math.floor(this.xPos), Math.floor(this.yPos), Date.now() - startTime));
            }
        }
        //check for finish line, must have all checkpoints completed
        if (collisionMap[Math.floor(this.yPos)][Math.floor(this.xPos)] == 2 && checkpoints.length == currentTrack.cpCount) {
            currentTime = Date.now();
            if (currentTime - startTime < currentTrack.bestTime || currentTrack.bestTime == null) { //store best time
                currentTrack.bestTime = currentTime - startTime;
                localStorage.setItem(currentTrack.name + "-bestTime", currentTrack.bestTime);
                currentTrack.bestCp = [];
                for (let i = 0; i < checkpoints.length; i++) {
                    currentTrack.bestCp.push(checkpoints[i].time);
                }
                localStorage.setItem(currentTrack.name + "-bestCp", JSON.stringify(currentTrack.bestCp)); //store best checkpoints as string
            }
            lastTime = currentTime - startTime;
            prepareLap();
        }
        //if touching void, immediately reset lap
        if (collisionMap[Math.floor(this.yPos)][Math.floor(this.xPos)] == 4) {
            prepareLap();
        }
    }
    draw() { //drawing a rotated boat involves rotating and restoring the entire canvas
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 1.2);
        if (boatCam) { //rotate or lock based on camera choice
            let speedAngle = Math.atan2(this.yVel, this.xVel);
            if (Math.sqrt(this.xVel * this.xVel + this.yVel * this.yVel) < 0.1) ctx.rotate(Math.PI * 3 / 2);
            else ctx.rotate(Math.PI * 3 /2 + this.angle - speedAngle);
        } else ctx.rotate(Math.PI * 3 / 2);
        ctx.fillStyle = "#8a5500ff";
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        ctx.beginPath();
        ctx.fillStyle = "rgba(72, 39, 0, 1)";
        ctx.moveTo(-3, -3);
        ctx.lineTo(3, 0);
        ctx.lineTo(-3, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}
let boat;

class Particle { // particles that become transparent and delete and KIND OF stick to the track where they should be
    constructor() {
        this.x = boat.xPos;
        this.y = boat.yPos;
        this.size = 5;
        this.alpha = 1;
        this.decay = 0.02;
        this.hue = Math.round((Math.random() * 50));
    }
    draw() {
        ctx.fillStyle = "hsla(" + this.hue + ", 100%, 50%, " + this.alpha + ")";
        ctx.beginPath();
        ctx.arc(this.x - boat.xPos, this.y - boat.yPos, this.size, 0, Math.PI * 2); //shouldn't drift, but not too noticeable
        ctx.fill();
    }
}

function handleParticles() { //update particle decay and draw them
    for (let i = 0; i < particles.length; i++) {
        let p = particles[i];
        if (p.alpha > p.decay) p.alpha -= p.decay;
        else {
            particles.splice(i, 1);
            i--;
        }
        p.draw();

    }
}

function camera() {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 1.2);
    if (boatCam) {
        let speedAngle = Math.atan2(boat.yVel, boat.xVel);
        if (Math.sqrt(boat.xVel * boat.xVel + boat.yVel * boat.yVel) < 0.1) speedAngle = boat.angle;
        ctx.rotate(-speedAngle + Math.PI * 3 /2);
    } else ctx.rotate(Math.PI * 3 / 2 - boat.angle);
    ctx.drawImage(trackImg, boat.xPos - zoom * trackWidth / 2, boat.yPos - zoom / 2 * trackWidth, zoom * trackWidth, zoom * trackWidth, -canvas.width, -canvas.height, canvas.width*2, canvas.height*2);
    handleParticles();
    ctx.restore();
}

function overlays() {
    //camera view and reset info
    ctx.fillStyle = "rgba(255, 255, 255, 0.47)";
    ctx.fillRect(5, 5, 212, 55);
    ctx.fillStyle = "black";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "20px Verdana";
    ctx.fillText("View (B): " + ((boatCam) ? "Boat Cam" : "Vanilla Cam"), 10, 10);
    ctx.fillText("Press (R) to Reset", 10, 35);

    //start text
    if (startText == 1) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "30px Verdana";
        ctx.fillText("SET", canvas.width / 2, canvas.height / 2);
    } else if (startText == 2) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "30px Verdana";
        ctx.fillText("GO", canvas.width / 2, canvas.height / 2);
    }

    //current timer and checkpoint delta
    //sig figs reduced because of random uncertainty
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "20px Verdana";
    let timeRaw, timeMin, timeSec;
    if (state == "drive") {
        ctx.fillStyle = "rgba(255, 255, 255, 0.47)";
        ctx.fillRect(canvas.width / 2 - 60, canvas.height - 65, 120, 60);
        ctx.fillStyle = "black";
        currentTime = Date.now();
        timeRaw = (currentTime - startTime) / 1000;
        timeMin = Math.floor(timeRaw / 60);
        timeSec = timeRaw % 60;
        ctx.fillText(((timeMin == 0) ? "" : timeMin + ":") + timeSec.toFixed(1), canvas.width / 2, canvas.height - 10); //current
        if (checkpoints.length > 0 && currentTrack.bestCp != null) {
            let cpDelta = (checkpoints[checkpoints.length - 1].time - currentTrack.bestCp[checkpoints.length - 1]) / 1000;
            if (Number(cpDelta.toFixed(1)) > 0) ctx.fillStyle = "#c20000ff";
            else if (Number(cpDelta.toFixed(1)) < 0) ctx.fillStyle = "#009a00ff";
            else ctx.fillStyle = "#9ebe00ff"
            timeMin = (cpDelta > 0) ? Math.floor(cpDelta / 60) : Math.ceil(cpDelta / 60);
            timeSec = cpDelta % 60;
            ctx.fillText(((cpDelta > 0) ? "+" : "") + ((timeMin == 0) ? "" : timeMin + ":") + timeSec.toFixed(1), canvas.width / 2, canvas.height - 35); //checkpoint delta
        }
    }
    //last and best times
    ctx.fillStyle = "rgba(255, 255, 255, 0.47)";
    ctx.fillRect(canvas.width - 160, 5, 153, 55);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "black";
    if (lastTime == null) ctx.fillText("Last: N/A", canvas.width - 145, 10); //last
    else {
        timeRaw = lastTime / 1000;
        timeMin = Math.floor(timeRaw / 60);
        timeSec = timeRaw % 60;
        ctx.fillText("Last: " + ((timeMin == 0) ? "" : timeMin + ":") + timeSec.toFixed(1), canvas.width - 145, 10);
    }
    if (currentTrack.bestTime == null) ctx.fillText("Best: N/A", canvas.width - 147, 35); //best
    else {
        timeRaw = currentTrack.bestTime / 1000;
        timeMin = Math.floor(timeRaw / 60);
        timeSec = timeRaw % 60;
        ctx.fillText("Best: " + ((timeMin == 0) ? "" : timeMin + ":") + timeSec.toFixed(1), canvas.width - 147, 35);
    }
}

function drawMenu() { //track selection name and image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";
    ctx.font = "50px Verdana";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(tracks[trackIndex].name, canvas.width / 2, 40);
    ctx.fillRect(95, 95, canvas.width - 190, canvas.height - 190);
    ctx.drawImage(tracks[trackIndex].image, 0, 0, trackWidth, trackWidth, 100, 100, canvas.width - 200, canvas.height - 200);
}

function prepareLap() { //reset boat physics, time and checkpoints, and trigger start
    state = "hold";
    boat.xPos = currentTrack.x;
    boat.yPos = currentTrack.y;
    boat.xVel = 0;
    boat.yVel = 0;
    boat.angle = currentTrack.angle;
    boat.angVel = 0;
    startText = 1;
    timer = 0;
    checkpoints = [];
    setTimeout(() => {
        startText = 2;
        startLap();
    }, 1000);
}

function startLap() { //start timer, resets physics again to prevent spamming R from saving time
    state = "drive";
    startTime = Date.now();
    boat.xPos = currentTrack.x;
    boat.yPos = currentTrack.y;
    boat.xVel = 0;
    boat.yVel = 0;
    boat.angle = currentTrack.angle;
    boat.angVel = 0;
    timer = 0;
    checkpoints = [];
    setTimeout(() => {
        startText = 0;
    }, 1000);
}

//put keypresses into keys list
window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
});
window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
});
window.addEventListener("keypress", (e) => { // toggle camera view, reset lap
    if (e.code == "KeyB" && state != "select") boatCam = !boatCam;
    if (e.code == "KeyR" && state == "drive") prepareLap();
});
btnLeft.addEventListener("click", () => { //select prior track, wrap to other end of list
    if (trackIndex > 0) trackIndex--;
    else trackIndex = tracks.length - 1;
})
btnRight.addEventListener("click", () => { //select next track, wrap to other end of list
    if (trackIndex < tracks.length - 1) trackIndex++;
    else trackIndex = 0;
})
btnGo.addEventListener("click", () => { //select current track
    if (state == "select") {
        selectTrack();
        boat = new Boat();
        state = "hold";
        prepareLap();
        btnGo.innerText = "Back";
        console.log(trackIndex);
    } else {
        state = "select";
        btnGo.innerText = "GO";
        collisionMap = [];
        lastTime = null;
        checkpoints = [];
    }
});

function animate() { //animate at the same fps regardless of computer performance (I hope)
    requestAnimationFrame(animate);
    now = Date.now();
    elapsed = now - then;
    if (elapsed > fpsInterval) {
        then = now - (elapsed % fpsInterval);

        //animation code
        if (state != "select") {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            camera();
            if (state == "drive") boat.update();
            
            if (particleRate == 7) { // particles behind boat. Higher number -> less particles
                particleRate = 0;
                particles.push(new Particle());
            } else particleRate++;

            boat.draw();
            overlays();
        } else drawMenu();
    }
}

function startAnimating(fps) {
    fpsInterval = 1000 / fps;
    then = Date.now();
    animate();
}

//start loop
startAnimating(60);