document.addEventListener("DOMContentLoaded", function(event) {

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const keyboardFrequencyMap = {
    '90': 261.625565300598634,  //Z - C
    '83': 277.182630976872096, //S - C#
    '88': 293.664767917407560,  //X - D
    '68': 311.126983722080910, //D - D#
    '67': 329.627556912869929,  //C - E
    '86': 349.228231433003884,  //V - F
    '71': 369.994422711634398, //G - F#
    '66': 391.995435981749294,  //B - G
    '72': 415.304697579945138, //H - G#
    '78': 440.000000000000000,  //N - A
    '74': 466.163761518089916, //J - A#
    '77': 493.883301256124111,  //M - B
    '81': 523.251130601197269,  //Q - C
    '50': 554.365261953744192, //2 - C#
    '87': 587.329535834815120,  //W - D
    '51': 622.253967444161821, //3 - D#
    '69': 659.255113825739859,  //E - E
    '82': 698.456462866007768,  //R - F
    '53': 739.988845423268797, //5 - F#
    '84': 783.990871963498588,  //T - G
    '54': 830.609395159890277, //6 - G#
    '89': 880.000000000000000,  //Y - A
    '55': 932.327523036179832, //7 - A#
    '85': 987.766602512248223,  //U - B
    }

    window.addEventListener('keydown', keyDown, false);
    window.addEventListener('keyup', keyUp, false);

    const pinkShades = ['#ff96cb', '#ffa5d2', '#ffb4da','#ffc3e1']; // background options
    let waveform = 'square'; // default waveform

    const buttons = document.querySelectorAll('.heart-button');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            waveform = btn.dataset.wave;
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    activeOscillators = {}

    function keyDown(event) {
        const key = (event.detail || event.which).toString();
        if (keyboardFrequencyMap[key] && !activeOscillators[key]) {
            playNote(key);
            changeBackground();
        }
    }

    function keyUp(event) {
        const key = (event.detail || event.which).toString();
        if (keyboardFrequencyMap[key] && activeOscillators[key]) {
            const note = activeOscillators[key].gain;

            note.gain.setValueAtTime(0.1, audioCtx.currentTime); //sustain
            note.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5); //release (ramp down to 0.01 in 0.5 secs)

            activeOscillators[key].osc.stop(audioCtx.currentTime + 0.5); //stop oscillator after release (0.5)
            // activeOscillators[key].osc.stop();
            delete activeOscillators[key];
        }
    }

    function playNote(key) {
        const osc = audioCtx.createOscillator();
        osc.frequency.setValueAtTime(keyboardFrequencyMap[key], audioCtx.currentTime)
        osc.type = waveform //choose your favorite waveform

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.01, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.1, audioCtx.currentTime + 0.1); //attack
        osc.connect(gain);
        
        globalGain = audioCtx.createGain();
        globalGain.gain.setValueAtTime(0.8, audioCtx.currentTime);
        globalGain.connect(audioCtx.destination);

        gain.connect(globalGain);
        globalGain.connect(audioCtx.destination);

        // osc.connect(audioCtx.destination);

        osc.start();
        activeOscillators[key] = {osc: osc, gain: gain};
        document.body.style.backgroundColor = pinkShades[Math.floor(Math.random() * pinkShades.length)];

    }
});

