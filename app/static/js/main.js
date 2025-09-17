
const lookupForm = document.getElementById('lookup-form');
const lookupInput = document.getElementById('lookup-input');
const lookupResults = document.getElementById('lookup-results');
const ocrForm = document.getElementById('ocr-form');
const ocrInput = document.getElementById('ocr-input');
const ocrResults = document.getElementById('ocr-results');
const ocrFeedback = document.getElementById('ocr-feedback');

const detailCard = document.getElementById('character-detail');
const detailGlyph = document.getElementById('detail-glyph');
const detailMeta = document.getElementById('detail-meta');
const detailPinyin = document.getElementById('detail-pinyin');
const detailDefinition = document.getElementById('detail-definition');
const detailExtra = document.getElementById('detail-extra');
const detailSvg = document.getElementById('detail-svg');

const playButton = document.getElementById('btn-play');
const stepButton = document.getElementById('btn-step');
const speakButton = document.getElementById('btn-speak');
const copyButton = document.getElementById('btn-copy');

const DEFAULT_STROKE_DURATION = 450;

const animState = {
    isAnimating: false,
    rafId: null,
    currentStrokeIndex: 0,
    strokes: [],
};

let currentCharacterData = null;
let activeCardElement = null;
let currentSvgToken = 0;

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

function highlightCard(card) {
    if (activeCardElement && activeCardElement !== card) {
        activeCardElement.style.outline = '';
        activeCardElement.style.outlineOffset = '';
        activeCardElement.setAttribute('aria-pressed', 'false');
    }
    activeCardElement = card || null;
    if (activeCardElement) {
        activeCardElement.style.outline = '3px solid var(--accent)';
        activeCardElement.style.outlineOffset = '2px';
        activeCardElement.setAttribute('aria-pressed', 'true');
    }
}

function clearSelection() {
    currentCharacterData = null;
    if (activeCardElement) {
        activeCardElement.style.outline = '';
        activeCardElement.style.outlineOffset = '';
        activeCardElement.setAttribute('aria-pressed', 'false');
        activeCardElement = null;
    }
    detailCard.hidden = true;
    detailGlyph.textContent = '';
    detailMeta.textContent = '';
    detailPinyin.innerHTML = '';
    detailDefinition.textContent = '';
    detailExtra.textContent = '';
    detailSvg.innerHTML = '';
    detailSvg.removeAttribute('aria-label');
    if (animState.rafId) {
        cancelAnimationFrame(animState.rafId);
        animState.rafId = null;
    }
    animState.isAnimating = false;
    animState.currentStrokeIndex = 0;
    animState.strokes = [];
    updateButtons();
}

function clearCanvasAndGuides() {
    animState.strokes.forEach((stroke) => {
        stroke.path.style.transition = 'none';
        stroke.path.style.strokeDasharray = `${stroke.length}`;
        stroke.path.style.strokeDashoffset = `${stroke.length}`;
    });
}

function renderStrokesUpTo(index) {
    animState.strokes.forEach((stroke, i) => {
        const offset = i <= index ? 0 : stroke.length;
        stroke.path.style.strokeDashoffset = `${offset}`;
    });
}

function updateButtons() {
    const hasStrokes = animState.strokes.length > 0;
    const atEnd = hasStrokes && animState.currentStrokeIndex >= animState.strokes.length;
    playButton.disabled = !hasStrokes;
    stepButton.disabled = !hasStrokes || animState.isAnimating || atEnd;
    speakButton.disabled = !currentCharacterData;
    copyButton.disabled = !currentCharacterData;
}

function resetAnimation() {
    if (animState.rafId) {
        cancelAnimationFrame(animState.rafId);
        animState.rafId = null;
    }
    animState.isAnimating = false;
    animState.currentStrokeIndex = 0;
    clearCanvasAndGuides();
    renderStrokesUpTo(-1);
    updateButtons();
}

function runStrokeLoop() {
    const index = animState.currentStrokeIndex;
    if (index >= animState.strokes.length) {
        animState.isAnimating = false;
        updateButtons();
        return;
    }
    animateSingleStroke(index, () => {
        animState.currentStrokeIndex += 1;
        if (animState.isAnimating) {
            runStrokeLoop();
        }
        updateButtons();
    });
}

function animateSingleStroke(index, onDone) {
    const stroke = animState.strokes[index];
    if (!stroke) {
        if (onDone) onDone();
        return;
    }
    const startLength = stroke.length;
    stroke.path.style.strokeDashoffset = `${startLength}`;
    const startTime = performance.now();
    const duration = stroke.duration || DEFAULT_STROKE_DURATION;

    function frame(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const offset = startLength * (1 - progress);
        stroke.path.style.strokeDashoffset = `${offset}`;
        if (progress < 1) {
            animState.rafId = requestAnimationFrame(frame);
        } else {
            animState.rafId = null;
            stroke.path.style.strokeDashoffset = '0';
            if (onDone) onDone();
        }
    }

    animState.rafId = requestAnimationFrame(frame);
}

function playAnimationFromStart() {
    if (!animState.strokes.length) {
        return;
    }
    resetAnimation();
    animState.isAnimating = true;
    updateButtons();
    runStrokeLoop();
}

function stepOneStroke() {
    if (!animState.strokes.length) {
        return;
    }
    if (animState.isAnimating && animState.rafId) {
        cancelAnimationFrame(animState.rafId);
        animState.rafId = null;
        animState.isAnimating = false;
    }
    if (animState.currentStrokeIndex < animState.strokes.length) {
        animateSingleStroke(animState.currentStrokeIndex, () => {
            animState.currentStrokeIndex += 1;
            updateButtons();
        });
    }
}

async function loadCharacterSvg(data) {
    currentSvgToken += 1;
    const token = currentSvgToken;
    animState.strokes = [];
    animState.currentStrokeIndex = 0;
    updateButtons();

    if (!data.svg) {
        detailSvg.innerHTML = '';
        const message = document.createElement('p');
        message.className = 'empty-state';
        message.textContent = 'Stroke animation is not available for this character.';
        detailSvg.appendChild(message);
        detailSvg.setAttribute('role', 'note');
        detailSvg.setAttribute('aria-label', message.textContent);
        return;
    }

    const loading = document.createElement('p');
    loading.className = 'empty-state';
    loading.textContent = 'Loading stroke animation…';
    detailSvg.innerHTML = '';
    detailSvg.appendChild(loading);
    detailSvg.setAttribute('role', 'note');
    detailSvg.setAttribute('aria-label', loading.textContent);

    try {
        const response = await fetch(data.svg);
        if (!response.ok) {
            throw new Error('Unable to load stroke animation.');
        }
        const svgText = await response.text();
        if (token !== currentSvgToken) {
            return;
        }
        const parser = new DOMParser();
        const documentSvg = parser.parseFromString(svgText, 'image/svg+xml');
        const svgElement = documentSvg.querySelector('svg');
        if (!svgElement) {
            throw new Error('Invalid SVG data.');
        }
        svgElement.querySelectorAll('style').forEach((node) => node.remove());
        svgElement.setAttribute('width', '100%');
        svgElement.setAttribute('height', '100%');
        svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const strokePaths = Array.from(
            svgElement.querySelectorAll('path[id^="make-me-a-hanzi-animation-"]')
        );
        strokePaths.sort((a, b) => {
            const aIndex = parseInt(a.id.replace('make-me-a-hanzi-animation-', ''), 10);
            const bIndex = parseInt(b.id.replace('make-me-a-hanzi-animation-', ''), 10);
            return aIndex - bIndex;
        });

        const strokes = strokePaths.map((path) => {
            const length = path.getTotalLength();
            path.style.fill = 'none';
            path.style.strokeDasharray = `${length}`;
            path.style.strokeDashoffset = `${length}`;
            path.style.strokeLinecap = path.style.strokeLinecap || 'round';
            path.style.transition = 'none';
            return {
                path,
                length,
                duration: DEFAULT_STROKE_DURATION,
            };
        });

        detailSvg.innerHTML = '';
        detailSvg.appendChild(svgElement);
        detailSvg.setAttribute('role', 'img');
        detailSvg.setAttribute(
            'aria-label',
            `Stroke order animation for ${data.character}`
        );

        animState.strokes = strokes;
        resetAnimation();
    } catch (error) {
        console.error(error);
        if (token !== currentSvgToken) {
            return;
        }
        detailSvg.innerHTML = '';
        const message = document.createElement('p');
        message.className = 'empty-state';
        message.textContent = 'Unable to load stroke animation.';
        detailSvg.appendChild(message);
        detailSvg.setAttribute('role', 'note');
        detailSvg.setAttribute('aria-label', message.textContent);
        animState.strokes = [];
        animState.currentStrokeIndex = 0;
        animState.isAnimating = false;
        updateButtons();
    }
}

function selectCharacter(data, cardElement) {
    if (!data) {
        return;
    }
    currentCharacterData = data;
    highlightCard(cardElement || null);

    detailGlyph.textContent = data.character || '';
    if (data.stroke_count) {
        detailMeta.textContent = `${data.codepoint} · ${data.stroke_count} strokes`;
    } else {
        detailMeta.textContent = data.codepoint || '';
    }

    detailPinyin.innerHTML = '';
    if (data.pinyin && data.pinyin.length) {
        data.pinyin.forEach((item) => {
            const badge = document.createElement('span');
            badge.textContent = item;
            detailPinyin.appendChild(badge);
        });
    } else {
        const placeholder = document.createElement('span');
        placeholder.textContent = 'No pinyin data';
        detailPinyin.appendChild(placeholder);
    }

    if (!data.available) {
        detailDefinition.textContent = 'This character is not present in the Make Me a Hanzi dataset yet.';
    } else {
        detailDefinition.textContent =
            data.definition || 'No definition available in this dataset.';
    }

    const extras = [];
    if (data.radical) extras.push(`Radical: ${data.radical}`);
    if (data.decomposition) extras.push(`Decomposition: ${data.decomposition}`);
    detailExtra.textContent = extras.join(' · ');

    detailCard.hidden = false;

    if (animState.rafId) {
        cancelAnimationFrame(animState.rafId);
        animState.rafId = null;
    }
    animState.isAnimating = false;
    animState.currentStrokeIndex = 0;
    animState.strokes = [];
    updateButtons();

    if (!data.available) {
        detailSvg.innerHTML = '';
        const message = document.createElement('p');
        message.className = 'empty-state';
        message.textContent = 'Stroke animation is not available for this character.';
        detailSvg.appendChild(message);
        detailSvg.setAttribute('role', 'note');
        detailSvg.setAttribute('aria-label', message.textContent);
        return;
    }

    loadCharacterSvg(data);
}

function createCard(data, sourceId) {
    const card = document.createElement('article');
    card.className = 'character-card';
    card.dataset.source = sourceId;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', 'false');

    const head = document.createElement('div');
    head.className = 'character-card__head';
    const glyph = document.createElement('span');
    glyph.className = 'character-card__glyph';
    glyph.textContent = data.character;
    head.appendChild(glyph);

    const meta = document.createElement('div');
    meta.className = 'character-card__meta';
    meta.textContent = data.stroke_count
        ? `${data.codepoint} · ${data.stroke_count} strokes`
        : data.codepoint;
    head.appendChild(meta);
    card.appendChild(head);

    if (!data.available) {
        const missing = document.createElement('p');
        missing.className = 'character-card__definition';
        missing.textContent = 'This character is not present in the Make Me a Hanzi dataset yet.';
        card.appendChild(missing);
    } else {
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
    }

    card.addEventListener('click', () => selectCharacter(data, card));
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectCharacter(data, card);
        }
    });

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
        if (activeCardElement && activeCardElement.dataset.source === container.id) {
            clearSelection();
        }
        return;
    }

    const fragment = document.createDocumentFragment();
    characters.forEach((character) => {
        fragment.appendChild(createCard(character, container.id));
    });
    container.appendChild(fragment);

    const firstCard = container.querySelector('.character-card');
    if (firstCard) {
        selectCharacter(characters[0], firstCard);
    }
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

playButton.addEventListener('click', playAnimationFromStart);
stepButton.addEventListener('click', stepOneStroke);
speakButton.addEventListener('click', () => {
    if (!currentCharacterData) {
        return;
    }
    const hint = currentCharacterData.pinyin ? currentCharacterData.pinyin.join(', ') : '';
    speakCharacter(currentCharacterData.character, hint);
});
copyButton.addEventListener('click', () => {
    if (!currentCharacterData) {
        return;
    }
    copyToClipboard(currentCharacterData.character);
});

renderCharacters(lookupResults, [], 'Enter a Chinese character to begin.');
renderCharacters(ocrResults, [], 'Upload a photo to see recognized characters.');
updateButtons();
