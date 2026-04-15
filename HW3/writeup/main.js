const textToType = `Lab 3 Writeup`;

const speed = 50; // Delay in milliseconds between characters
let i = 0;

function typeWriter() {
    if (i < textToType.length) {
        document.getElementById("typewriter-text").innerHTML += textToType.charAt(i);
        i++;
        setTimeout(typeWriter, speed);
    }
}

window.onload = typeWriter;