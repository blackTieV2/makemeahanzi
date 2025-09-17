const lookupForm = document.getElementById('lookup-form');
const lookupInput = document.getElementById('lookup-input');
const lookupResults = document.getElementById('lookup-results');
const ocrForm = document.getElementById('ocr-form');
const ocrInput = document.getElementById('ocr-input');
const ocrResults = document.getElementById('ocr-results');
const ocrFeedback = document.getElementById('ocr-feedback');

function speakCharacter(character, pinyinHint = '') {
    if (!('speechSynthesis' in window)) {
        alert('Speech synthesis is not supported in this browser.');
        return;
    }
    const utterance = new SpeechSynthesisUtterance(character);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.text = pinyinHint ? `${character} ${pinyinHint}` : character;
    window.speechSynthesis.speak(utterance);
}

function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(() => {
            console.warn('Unable to copy to clipboard.');
        });
    }
}

function createCard(data) {
    const card = document.createElement('article');
    card.className = 'character-card';

    const head = document.createElement('div');
    head.className = 'character-card__head';
    const glyph = document.createElement('span');
    glyph.className = 'character-card__glyph';
    glyph.textContent = data.character;
    head.appendChild(glyph);

    const meta = document.createElement('div');
    meta.className = 'character-card__meta';
    meta.textContent = `${data.codepoint}${data.stroke_count ? ` · ${data.stroke_count} strokes` : ''}`;
    head.appendChild(meta);
    card.appendChild(head);

    if (!data.available) {
        const missing = document.createElement('p');
        missing.className = 'character-card__definition';
        missing.textContent = 'This character is not present in the Make Me a Hanzi dataset yet.';
        card.appendChild(missing);
        return card;
    }

    const pinyin = document.createElement('div');
    pinyin.className = 'character-card__pinyin';
    if (data.pinyin && data.pinyin.length) {
        data.pinyin.forEach((item) => {
            const badge = document.createElement('span');
            badge.textContent = item;
            pinyin.appendChild(badge);
        });
    } else {
        const placeholder = document.createElement('span');
        placeholder.textContent = 'No pinyin data';
        pinyin.appendChild(placeholder);
    }
    card.appendChild(pinyin);

    const definition = document.createElement('p');
    definition.className = 'character-card__definition';
    definition.textContent = data.definition || 'No definition available in this dataset.';
    card.appendChild(definition);

    const details = document.createElement('div');
    details.className = 'character-card__meta';
    const parts = [];
    if (data.radical) parts.push(`Radical: ${data.radical}`);
    if (data.decomposition) parts.push(`Decomposition: ${data.decomposition}`);
    details.textContent = parts.join(' · ');
    card.appendChild(details);

    if (data.svg) {
        const svgWrapper = document.createElement('object');
        svgWrapper.className = 'character-card__svg';
        svgWrapper.type = 'image/svg+xml';
        svgWrapper.data = data.svg;
        svgWrapper.setAttribute('aria-label', `Stroke order animation for ${data.character}`);
        card.appendChild(svgWrapper);
    }

    const actions = document.createElement('div');
    actions.className = 'character-card__actions';

    const speakButton = document.createElement('button');
    speakButton.type = 'button';
    speakButton.textContent = 'Play sound';
    speakButton.addEventListener('click', () => {
        const hint = data.pinyin ? data.pinyin.join(', ') : '';
        speakCharacter(data.character, hint);
    });
    actions.appendChild(speakButton);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'Copy character';
    copyButton.addEventListener('click', () => copyToClipboard(data.character));
    actions.appendChild(copyButton);

    card.appendChild(actions);

    return card;
}

function renderCharacters(container, characters, emptyMessage) {
    container.innerHTML = '';
    if (!characters.length) {
        if (emptyMessage) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = emptyMessage;
            container.appendChild(empty);
        }
        return;
    }
    characters.forEach((character) => {
        container.appendChild(createCard(character));
    });
}

async function performLookup(text) {
    if (!text.trim()) {
        renderCharacters(lookupResults, [], 'Enter a Chinese character to see details.');
        return;
    }
    try {
        const params = new URLSearchParams({ text });
        const response = await fetch(`/api/lookup?${params.toString()}`);
        if (!response.ok) {
            throw new Error('Lookup failed');
        }
        const payload = await response.json();
        renderCharacters(
            lookupResults,
            payload.characters,
            'No Chinese characters were detected in the input.'
        );
    } catch (error) {
        renderCharacters(lookupResults, [], 'Unable to look up the character. Please try again.');
    }
}

async function performOcr(file) {
    if (!file) {
        renderCharacters(ocrResults, [], 'Upload a photo to see OCR results.');
        return;
    }
    ocrFeedback.textContent = 'Recognizing characters…';
    const body = new FormData();
    body.append('file', file);

    try {
        const response = await fetch('/api/ocr', {
            method: 'POST',
            body,
        });
        if (!response.ok) {
            throw new Error('OCR request failed');
        }
        const payload = await response.json();
        if (payload.recognized_text) {
            ocrFeedback.textContent = `Recognized text: ${payload.recognized_text}`;
        } else {
            ocrFeedback.textContent = 'No Chinese characters detected.';
        }
        renderCharacters(
            ocrResults,
            payload.characters || [],
            'Upload a sharper image if no characters were detected.'
        );
    } catch (error) {
        console.error(error);
        ocrFeedback.textContent = 'We could not process that image. Try another photo.';
        renderCharacters(ocrResults, [], '');
    }
}

lookupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    performLookup(lookupInput.value || '');
});

ocrForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const [file] = ocrInput.files || [];
    performOcr(file);
});

lookupInput.addEventListener('blur', () => {
    if (lookupInput.value && !lookupResults.querySelector('.character-card')) {
        performLookup(lookupInput.value);
    }
});

ocrInput.addEventListener('change', () => {
    const [file] = ocrInput.files || [];
    if (file) {
        performOcr(file);
    }
});

renderCharacters(lookupResults, [], 'Enter a Chinese character to begin.');
renderCharacters(ocrResults, [], 'Upload a photo to see recognized characters.');
