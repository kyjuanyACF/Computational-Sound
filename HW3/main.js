const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let firstClick = true;

// --- AUDIO SYNTHESIS ---
function playWaterPlop(ctx) {
    const osc = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const masterGain = ctx.createGain();

    // Randomize frequency slightly for organic variety
    const baseFreq = 350 + (Math.random() * 150);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    // The "Bloop" sweep
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.6, ctx.currentTime + 0.04);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.9, ctx.currentTime + 0.15);

    // Frequency Modulation (The splash texture)
    mod.frequency.value = 180;
    modGain.gain.setValueAtTime(300, ctx.currentTime);
    modGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.04);

    mod.connect(modGain);
    modGain.connect(osc.frequency);
    osc.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Volume Envelope
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    osc.start();
    mod.start();
    osc.stop(ctx.currentTime + 0.25);
    mod.stop(ctx.currentTime + 0.25);
}

// -- INTERACTION ---
window.addEventListener('click', (e) => {
    if (audioCtx.state === 'suspended') audioCtx.resume();

    //fade directions after first click
    if (firstClick) {
        document.getElementById('directions').style.opacity = '0';
        firstClick = false;
    }

    const x = e.clientX;
    const y = e.clientY;
    const fallTime = 500 + (Math.random() * 300);

    //create rain drip
    const drop = document.createElement('div');
    drop.className = 'drop';
    drop.style.left = x + 'px';
    drop.style.top = '-30px';
    document.body.appendChild(drop);

    //animation of drop falling
    setTimeout(() => {
        drop.style.transition = `transform ${fallTime}ms cubic-bezier(0.6, 0.05, 1, 0.4)`;
        drop.style.transform = `translateY(${y + 30}px)`;
    }, 10);

    // 3. Impact
    setTimeout(() => {
        drop.remove();
        playWaterPlop(audioCtx);

        const ripple = document.createElement('div');
        ripple.className = 'ripple';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        document.body.appendChild(ripple);

        setTimeout(() => ripple.remove(), 1200);
    }, fallTime);
})