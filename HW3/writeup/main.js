const textToType = `Lab 3 Writeup: In this project, I tried to recreate a rain droplet sound using the Web Audio API, paired with a visual click-based falling drop interaction. Early versions didn’t work well, the sound came out metallic or like short beeps, and I had a hard time getting anything that sounded “wet” or like real water. I followed Practical 15, specifically figure 38.7 on raindrops on water, to better understand the expected behavior of droplet sounds.The final implementation uses a sine wave oscillator with a randomized base frequency so each drop sounds slightly different. I apply quick exponential frequency ramps to simulate the impact and settling of the droplet. A second oscillator provides FM synthesis, which adds instability and helps make the sound more organic. The amplitude is shaped with a gain node envelope that has a fast attack and rapid exponential decay, producing a short, plunk sound. Even with these techniques, it still doesn’t sound perfect, but it is the closest result I could achieve to a convincing rain droplet using this synthesis approach.
`;

const speed = 20; // Delay in milliseconds between characters
let i = 0;

function typeWriter() {
    if (i < textToType.length) {
        document.getElementById("typewriter-text").innerHTML += textToType.charAt(i);
        i++;
        setTimeout(typeWriter, speed);
    }
}

window.onload = typeWriter;