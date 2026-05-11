
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function play() {

    //Provided Brown Noise code
    const bufferSize = 10 * audioCtx.sampleRate;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = buffer.getChannelData(0);

    let lastOut = 0;

    for (let i = 0; i < bufferSize; i++) {
        const brown = Math.random() * 2 - 1;
        output[i] = (lastOut + 0.02 * brown) / 1.02;
        lastOut = output[i];

        output[i] *= 3.5;
    }

    var brownNoise = audioCtx.createBufferSource();
    brownNoise.buffer = buffer;
    brownNoise.loop = true;
    brownNoise.start();

    // const src = audioCtx.createBufferSource();
    // src.buffer = buffer;
    // src.loop = true;

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
    lpf2_gain.gain.value = 1000; //400 sounded to windy --> higher values created a greater bubblling noise
    
    // + 500
    const offset = audioCtx.createConstantSource();
    offset.offset.value = 100; //decreaed for less "whistling noise" 
    offset.start();

    //rhpf
    const rhpf = audioCtx.createBiquadFilter();
    rhpf.type = 'highpass';
    rhpf.Q.value = 1/0.03;
    
    brownNoise.connect(lpf1).connect(rhpf);

    brownNoise.connect(lpf2).connect(lpf2_gain).connect(rhpf.frequency);
    offset.connect(rhpf.frequency);

    rhpf.connect(mainGain).connect(audioCtx.destination)
}

document.getElementById("play-button").addEventListener("click", () => {
    play();
});
