
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function play() {
    // console.log("Babbling Brook");

    var bufferSize = 10 * audioCtx.sampleRate;
    noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    output = noiseBuffer.getChannelData(0);

    var lastOut = 0;
    for (var i = 0; i < bufferSize; i++) {
        var brown = Math.random() * 2 - 1;
    
        output[i] = (lastOut + (0.02 * brown)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5;
    }

    const mainGain = audioCtx.createGain();
    mainGain.gain.value = 0.2;

    var lpf1 = audioCtx.createBiquadFilter();
    lpf1.type = 'lowpass';
    lpf1.frequency.value = 400;

    var lpf2 = audioCtx.createBiquadFilter();
    lpf2.type = 'lowpass';
    lpf2.frequency.value = 14;
    
    // * 400
    const lpf2_gain = audioCtx.createGain();
    lpf2_gain.gain.value = 1000; //400 sounded to windy --> higher values created a greate rbubblling noise
    
    // + 500
    const offset = audioCtx.createConstantSource();
    offset.offset.value = 500; //500 sounded weird
    offset.start();

    //rhpf
    const rhpf = audioCtx.createBiquadFilter();
    rhpf.type = 'highpass';
    rhpf.Q.value = 1/0.03;

    var brownNoise = audioCtx.createBufferSource();
    brownNoise.buffer = noiseBuffer;
    brownNoise.loop = true;
    brownNoise.start();
    
    brownNoise.connect(lpf1).connect(rhpf);

    brownNoise.connect(lpf2).connect(lpf2_gain).connect(rhpf.frequency);
    offset.connect(rhpf.frequency);

    rhpf.connect(mainGain).connect(audioCtx.destination)
}

document.getElementById("play-button").addEventListener("click", () => {
    audioCtx.resume().then(play);
});
