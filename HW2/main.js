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

    const pinkShades = ['#ffafd7','#ffe1f0']; // background options
    let waveform = 'sine'; // default waveform

    // Initial settings for the synth engine
    let synthSettings = {
        partials: 5,
        amFreq: 50,
        depth: 0.5,
        fmFreq: 50,
        fmIndex: 250
    };  

    // Array of sliders
    const sliders = ['partials', 'amFreq', 'depth', 'fmFreq', 'fmIndex'];

    sliders.forEach(id => {
        const slider = document.getElementById(id);
        const display = document.getElementById(id + 'Val');

        if (slider && display) {
            slider.addEventListener('input', () => {
                // Update number on screen as slider moves
                if (id === 'depth'){
                    display.innerText = slider.value/100;
                } else if (id == 'fmIndex'){
                    display.innerText = slider.value * 5;
                } else{
                    display.innerText = slider.value;
                }
                //update slider value in synthSettings
                synthSettings[id] = parseInt(slider.value);
            });

            // Initialize nums on page load
            display.innerText = slider.value;
        }
    });

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
            // const note = activeOscillators[key].gain;

            // note.gain.setValueAtTime(0.1, audioCtx.currentTime); //sustain
            // note.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5); //release (ramp down to 0.01 in 0.5 secs)

            activeOscillators[key].gain.forEach(g => {
                // g.gain.cancelScheduledValues(audioCtx.currentTime);
                g.gain.setValueAtTime(g.gain.value, audioCtx.currentTime);
                g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
            });

            if (activeOscillators[key].oscs){
                activeOscillators[key].oscs.forEach(o => o.stop(audioCtx.currentTime + 0.15));
            }
            // activeOscillators[key].osc.stop(audioCtx.currentTime + 0.5); //stop oscillator after release (0.5)
            // activeOscillators[key].osc1.stop(audioCtx.currentTime + 0.5);
            // activeOscillators[key].osc2.stop(audioCtx.currentTime + 0.5);
            // activeOscillators[key].osc3.stop(audioCtx.currentTime + 0.5);

            delete activeOscillators[key];
        }
    }

    function playNote(key) {
        mode = document.getElementById('mode').value;

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.01, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.1, audioCtx.currentTime + 0.1); //attack

        const globalGain = audioCtx.createGain();
        globalGain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        globalGain.connect(audioCtx.destination);

        gain.connect(globalGain);

        if (mode == 'additive'){
            osc = audioCtx.createOscillator();
            osc.frequency.value = keyboardFrequencyMap[key];
            osc.connect(gain);

            lfo = audioCtx.createOscillator();
            lfo.frequency.value = 0.5;

            lfoGain = audioCtx.createGain();
            lfoGain.gain.value = 8;
            lfo.connect(lfoGain).connect(osc.frequency);
            lfo.connect(gain);
            lfo.start();

            osc.start();

            activeOscillators[key] = {oscs: [osc, lfo], gain: [gain, lfoGain]};

            for (var i = 1; i <= synthSettings.partials; i++){
                partialOsc = audioCtx.createOscillator();
                partialOsc.frequency.value = (i++ * keyboardFrequencyMap[key]) + Math.random() * 15;
                partialOsc.connect(gain);
                partialOsc.start();
                activeOscillators[key].oscs.push(partialOsc);
            }
            
            /*
            //additive synthesis - adding oscilators at diff frequencies
            // osc = audioCtx.createOscillator();
            osc1 = audioCtx.createOscillator();
            osc2 = audioCtx.createOscillator();
            osc3 = audioCtx.createOscillator();
            osc4 = audioCtx.createOscillator();
            // osc.frequency.value = keyboardFrequencyMap[key]
            osc1.frequency.value = keyboardFrequencyMap[key]
            osc2.frequency.value = (2 * keyboardFrequencyMap[key]) + Math.random() * 15;
            osc3.frequency.value = (3 * keyboardFrequencyMap[key]) - Math.random() * 15;
            osc4.frequency.value = (4 * keyboardFrequencyMap[key]) + Math.random() * 15;
            osc1.connect(gain)
            osc2.connect(gain);
            osc3.connect(gain);
            osc4.connect(gain);

            // osc.start();
            osc1.start();
            osc2.start();
            osc3.start();
            osc4.start();
            activeOscillators[key] = {oscs: [osc1, osc2, osc3, osc4], gain: [gain] };
            */

        } else if (mode === 'AM') {
            carrier = audioCtx.createOscillator();
            carrier.type = waveform;
            modulatorFreq = audioCtx.createOscillator();
            modulatorFreq.frequency.value = synthSettings.amFreq;
            carrier.frequency.value = keyboardFrequencyMap[key];

            modulatorGain = audioCtx.createGain();
            depth = audioCtx.createGain();
            depth.gain.value = synthSettings.depth/100;
            modulatorGain.gain.value = 1.0 - depth.gain.value;

            modulatorFreq.connect(depth).connect(modulatorGain.gain); 
            carrier.connect(modulatorGain)
            modulatorGain.connect(gain);
            
            carrier.start();
            modulatorFreq.start();
            activeOscillators[key] = {oscs: [carrier, modulatorFreq], gain: [gain,modulatorGain, depth] };
        } else if (mode === 'FM') {
            fmCarrier = audioCtx.createOscillator();
            fmCarrier.type = waveform;
            fmCarrier.frequency.value = keyboardFrequencyMap[key];
            modFreq = audioCtx.createOscillator();

            modIndex = audioCtx.createGain();
            modIndex.gain.value = synthSettings.fmIndex * 5;
            // modIndex.gain.setValueAtTime(0.0002, audioCtx.currentTime);
            // modIndex.gain.linearRampToValueAtTime(synthSettings.fmIndex, audioCtx.currentTime + 0.02)

            modFreq.frequency.value = synthSettings.fmFreq;

            modFreq.connect(modIndex);
            modIndex.connect(fmCarrier.frequency);

            fmCarrier.connect(gain);

            fmCarrier.start();
            modFreq.start();

            activeOscillators[key] = {oscs: [fmCarrier, modFreq], gain: [gain, modIndex] }

        } else {
            const osc = audioCtx.createOscillator();
            osc.frequency.setValueAtTime(keyboardFrequencyMap[key], audioCtx.currentTime)
            osc.type = waveform //choose your favorite waveform

            osc.connect(gain);

            osc.start();
            activeOscillators[key] = {oscs: [osc], gain: [gain]};
        }
    
        // osc.start();
        
        document.body.style.backgroundColor = pinkShades[Math.floor(Math.random() * pinkShades.length)];
    }

});

