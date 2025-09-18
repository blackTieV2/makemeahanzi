const queryForm = document.getElementById('query-form');
const queryInput = document.getElementById('query-input');
const candidateList = document.getElementById('candidate-list');
const workspacePlaceholder = document.getElementById('workspace-placeholder');
const workspaceCard = document.getElementById('workspace-card');
const glyphEl = document.getElementById('workspace-glyph');
const metaEl = document.getElementById('workspace-meta');
const pinyinEl = document.getElementById('workspace-pinyin');
const definitionEl = document.getElementById('workspace-definition');
const detailsEl = document.getElementById('workspace-details');
const strokeViewer = document.getElementById('stroke-viewer');
const playButton = document.getElementById('play-button');
const stepButton = document.getElementById('step-button');
const replayButton = document.getElementById('replay-button');
const soundButton = document.getElementById('sound-button');
const copyButton = document.getElementById('copy-button');
const ocrForm = document.getElementById('ocr-form');
const ocrInput = document.getElementById('ocr-input');
const ocrFeedback = document.getElementById('ocr-feedback');

const state = {
    candidates: [],
    selectedIndex: -1,
    candidateMessage: 'Enter Chinese characters or pinyin to begin.',
    currentCharacter: null,
    animation: {
        strokes: [],
        strokeIndex: 0,
        isPlaying: false,
        rafId: null,
        lastTimestamp: null,
        mode: 'play',
        loadToken: 0,
    },
};

let queryDebounce = 0;

const CJK_REGEX = /[\u2E80-\u2FDF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2EBEF}]/u;

function containsCjk(text) {
    return CJK_REGEX.test(text);
}

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

function clearWorkspace(message) {
    state.animation.loadToken += 1;
    pauseAnimation();
    state.animation.strokes = [];
    state.animation.strokeIndex = 0;
    state.animation.lastTimestamp = null;
    state.currentCharacter = null;
    glyphEl.textContent = '';
    metaEl.textContent = '';
    pinyinEl.innerHTML = '';
    definitionEl.textContent = '';
    detailsEl.textContent = '';
    strokeViewer.innerHTML = '';
    workspaceCard.hidden = true;
    workspacePlaceholder.hidden = false;
    workspacePlaceholder.textContent = message
        || 'Type Chinese characters, enter pinyin, or upload a photo to begin.';
    updateControls();
}

function renderCandidateList() {
    candidateList.innerHTML = '';
    if (!state.candidates.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = state.candidateMessage || 'No characters yet.';
        candidateList.appendChild(empty);
        return;
    }

    state.candidates.forEach((candidate, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'workspace__candidate';
        button.setAttribute('role', 'option');
        button.textContent = candidate.character;
        if (candidate.definition) {
            button.title = candidate.definition;
        }
        if (index === state.selectedIndex) {
            button.classList.add('is-active');
            button.setAttribute('aria-selected', 'true');
        } else {
            button.setAttribute('aria-selected', 'false');
        }
        button.addEventListener('click', () => {
            selectCandidate(index, { autoPlay: true });
        });
        candidateList.appendChild(button);
    });
}

function setCandidates(list, options = {}) {
    const {
        autoSelect = false,
        autoPlay = true,
        emptyMessage = 'No characters found.',
    } = options;

    state.candidates = list || [];
    state.selectedIndex = -1;
    state.candidateMessage = emptyMessage;
    renderCandidateList();

    if (!state.candidates.length) {
        if (!state.currentCharacter) {
            clearWorkspace(emptyMessage);
        } else {
            updateControls();
        }
        return;
    }

    if (autoSelect) {
        selectCandidate(0, { autoPlay });
    } else {
        updateControls();
    }
}

function updateControls() {
    const hasCharacter = Boolean(state.currentCharacter);
    const animation = state.animation;
    const hasStrokes = animation.strokes.length > 0;
    const isComplete = hasStrokes && animation.strokeIndex >= animation.strokes.length;

    playButton.disabled = !hasCharacter || !hasStrokes || (isComplete && !animation.isPlaying);
    playButton.textContent = animation.isPlaying ? 'Stop' : 'Play';
    stepButton.disabled = !hasCharacter || !hasStrokes || animation.isPlaying || isComplete;
    replayButton.disabled = !hasCharacter || !hasStrokes;
    soundButton.disabled = !hasCharacter;
    copyButton.disabled = !hasCharacter;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function computeStrokeDuration(length) {
    const seconds = clamp(length / 600, 0.35, 1.0);
    return seconds * 1000;
}

function setStrokeProgress(stroke, progress) {
    const clamped = clamp(progress, 0, 1);
    stroke.progress = clamped;
    const offset = (1 - clamped) * stroke.length;
    stroke.path.style.strokeDashoffset = `${offset}`;
}

function prepareStroke(path) {
    if (!(path instanceof SVGPathElement)) {
        return null;
    }
    try {
        const length = path.getTotalLength();
        if (!Number.isFinite(length) || length <= 0) {
            return null;
        }
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-dasharray', `${length}`);
        path.setAttribute('stroke-dashoffset', `${length}`);
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        path.style.fill = 'none';
        path.style.animation = 'none';
        path.style.transition = 'none';
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${length}`;
        path.style.vectorEffect = 'non-scaling-stroke';
        return {
            path,
            length,
            progress: 0,
            duration: computeStrokeDuration(length),
        };
    } catch (error) {
        console.warn('Unable to measure stroke length', error);
        return null;
    }
}

function pauseAnimation() {
    const animation = state.animation;
    if (animation.rafId !== null) {
        cancelAnimationFrame(animation.rafId);
        animation.rafId = null;
    }
    const wasPlaying = animation.isPlaying;
    animation.isPlaying = false;
    animation.lastTimestamp = null;
    animation.mode = 'play';
    if (wasPlaying) {
        updateControls();
    }
}

function resetAnimation(options = {}) {
    const { cancel = true } = options;
    if (cancel) {
        pauseAnimation();
    } else {
        state.animation.lastTimestamp = null;
        state.animation.mode = 'play';
    }
    state.animation.strokeIndex = 0;
    state.animation.strokes.forEach((stroke) => {
        setStrokeProgress(stroke, 0);
    });
    updateControls();
}

function initializeAnimationFromPaths(paths) {
    pauseAnimation();
    const prepared = [];
    paths.forEach((path) => {
        const stroke = prepareStroke(path);
        if (stroke) {
            prepared.push(stroke);
        }
    });

    state.animation.strokes = prepared;
    state.animation.strokeIndex = 0;
    state.animation.lastTimestamp = null;
    state.animation.mode = 'play';

    if (!prepared.length) {
        updateControls();
        return false;
    }

    prepared.forEach((stroke) => {
        setStrokeProgress(stroke, 0);
    });
    updateControls();
    return true;
}

function runAnimationFrame(timestamp) {
    const animation = state.animation;
    animation.rafId = null;

    if (!animation.isPlaying) {
        return;
    }

    if (animation.strokeIndex >= animation.strokes.length) {
        animation.isPlaying = false;
        updateControls();
        return;
    }

    const stroke = animation.strokes[animation.strokeIndex];
    if (!stroke) {
        animation.isPlaying = false;
        updateControls();
        return;
    }

    if (animation.lastTimestamp === null) {
        animation.lastTimestamp = timestamp;
    }

    const delta = timestamp - animation.lastTimestamp;
    animation.lastTimestamp = timestamp;

    if (delta > 0) {
        const progressIncrease = delta / stroke.duration;
        setStrokeProgress(stroke, stroke.progress + progressIncrease);
    }

    if (stroke.progress >= 1) {
        setStrokeProgress(stroke, 1);
        animation.strokeIndex += 1;
        animation.lastTimestamp = null;

        if (animation.strokeIndex >= animation.strokes.length) {
            animation.isPlaying = false;
            updateControls();
            return;
        }

        if (animation.mode === 'step') {
            animation.isPlaying = false;
            animation.mode = 'play';
            updateControls();
            return;
        }
    }

    if (animation.isPlaying) {
        animation.rafId = window.requestAnimationFrame(runAnimationFrame);
    }
}

function startAnimation(mode = 'play') {
    const animation = state.animation;
    if (!animation.strokes.length) {
        return false;
    }
    if (animation.strokeIndex >= animation.strokes.length) {
        return false;
    }

    if (animation.rafId !== null) {
        cancelAnimationFrame(animation.rafId);
        animation.rafId = null;
    }

    animation.mode = mode;
    animation.isPlaying = true;
    animation.lastTimestamp = null;
    animation.rafId = window.requestAnimationFrame(runAnimationFrame);
    updateControls();
    return true;
}

function playAnimation() {
    const animation = state.animation;
    if (!animation.strokes.length) {
        return;
    }
    if (animation.isPlaying) {
        pauseAnimation();
        return;
    }
    if (animation.strokeIndex >= animation.strokes.length) {
        resetAnimation({ cancel: false });
    }
    startAnimation('play');
}

function stepAnimation() {
    const animation = state.animation;
    if (!animation.strokes.length) {
        return;
    }
    if (animation.isPlaying) {
        pauseAnimation();
    }
    if (animation.strokeIndex >= animation.strokes.length) {
        updateControls();
        return;
    }
    startAnimation('step');
}

function replayAnimation() {
    if (!state.currentCharacter || !state.animation.strokes.length) {
        return;
    }
    resetAnimation();
    startAnimation('play');
}

function createFallbackSvg(strokes) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 1024 1024');
    svg.classList.add('workspace__svg');

    const gridGroup = document.createElementNS(svgNS, 'g');
    gridGroup.setAttribute('stroke', '#d7dde7');
    gridGroup.setAttribute('stroke-width', '8');
    gridGroup.setAttribute('fill', 'none');

    const gridLines = [
        { x1: 0, y1: 0, x2: 1024, y2: 1024 },
        { x1: 1024, y1: 0, x2: 0, y2: 1024 },
        { x1: 512, y1: 0, x2: 512, y2: 1024 },
        { x1: 0, y1: 512, x2: 1024, y2: 512 },
    ];
    gridLines.forEach((line) => {
        const element = document.createElementNS(svgNS, 'line');
        element.setAttribute('x1', line.x1);
        element.setAttribute('y1', line.y1);
        element.setAttribute('x2', line.x2);
        element.setAttribute('y2', line.y2);
        gridGroup.appendChild(element);
    });
    svg.appendChild(gridGroup);

    const strokeGroup = document.createElementNS(svgNS, 'g');
    strokeGroup.setAttribute('transform', 'scale(1, -1) translate(0, -900)');

    strokes.forEach((data) => {
        if (!data) {
            return;
        }
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', data);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#101828');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('stroke-width', '80');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        strokeGroup.appendChild(path);
    });

    svg.appendChild(strokeGroup);
    return svg;
}

function setupFallbackStrokes(strokes) {
    pauseAnimation();
    strokeViewer.innerHTML = '';

    if (!strokes || !strokes.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Stroke order data is not available for this character yet.';
        strokeViewer.appendChild(empty);
        state.animation.strokes = [];
        state.animation.strokeIndex = 0;
        updateControls();
        return false;
    }

    const svg = createFallbackSvg(strokes);
    strokeViewer.appendChild(svg);
    const paths = Array.from(svg.querySelectorAll('path'));
    const initialized = initializeAnimationFromPaths(paths);
    if (!initialized) {
        strokeViewer.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Stroke order data is not available for this character yet.';
        strokeViewer.appendChild(empty);
    }
    return initialized;
}

function parseSvgText(svgText) {
    if (!svgText) {
        return null;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) {
        return null;
    }
    const svg = doc.querySelector('svg');
    if (!svg) {
        return null;
    }
    const imported = document.importNode(svg, true);
    imported.classList.add('workspace__svg');
    imported.querySelectorAll('style').forEach((styleEl) => {
        styleEl.remove();
    });
    return imported;
}

async function loadStrokeSvg(data, loadToken) {
    if (!data) {
        return false;
    }

    const candidates = [];
    if (data.character) {
        const codePoint = data.character.codePointAt(0);
        if (Number.isFinite(codePoint)) {
            candidates.push(String(codePoint));
        }
    }
    if (typeof data.codepoint === 'string') {
        const hex = data.codepoint.replace(/^U\+/i, '');
        if (hex) {
            const decimal = parseInt(hex, 16);
            if (!Number.isNaN(decimal)) {
                candidates.push(String(decimal));
            }
            candidates.push(data.codepoint.toUpperCase());
        }
    }

    const tried = new Set();
    for (const candidate of candidates) {
        if (!candidate || tried.has(candidate)) {
            continue;
        }
        tried.add(candidate);
        try {
            const response = await fetch(`/stroke/${candidate}.svg`);
            if (!response.ok) {
                continue;
            }
            const svgText = await response.text();
            if (state.animation.loadToken !== loadToken) {
                return false;
            }
            const svgElement = parseSvgText(svgText);
            if (!svgElement) {
                continue;
            }
            strokeViewer.innerHTML = '';
            strokeViewer.appendChild(svgElement);

            const strokeSelector = 'path[id^="make-me-a-hanzi-animation"]';
            let pathElements = Array.from(svgElement.querySelectorAll(strokeSelector));
            if (!pathElements.length) {
                pathElements = Array.from(svgElement.querySelectorAll('path')).filter(
                    (path) => !path.closest('defs') && !path.closest('clipPath')
                );
            }
            const initialized = initializeAnimationFromPaths(pathElements);
            if (initialized) {
                return true;
            }
        } catch (error) {
            console.warn('Unable to load stroke SVG', error);
        }
    }
    return false;
}

function renderPinyin(pinyinList) {
    pinyinEl.innerHTML = '';
    if (!pinyinList || !pinyinList.length) {
        const placeholder = document.createElement('span');
        placeholder.textContent = 'No pinyin data';
        pinyinEl.appendChild(placeholder);
        return;
    }
    pinyinList.forEach((item) => {
        const badge = document.createElement('span');
        badge.textContent = item;
        pinyinEl.appendChild(badge);
    });
}

function renderWorkspace(data) {
    if (!data) {
        clearWorkspace();
        return;
    }

    state.currentCharacter = data;
    workspacePlaceholder.hidden = true;
    workspaceCard.hidden = false;

    glyphEl.textContent = data.character || '';
    const metaParts = [data.codepoint];
    if (data.stroke_count) {
        metaParts.push(`${data.stroke_count} strokes`);
    }
    metaEl.textContent = metaParts.filter(Boolean).join(' · ');

    renderPinyin(data.pinyin || []);
    definitionEl.textContent = data.definition || 'No definition available in this dataset.';

    const detailParts = [];
    if (data.radical) detailParts.push(`Radical: ${data.radical}`);
    if (data.decomposition) detailParts.push(`Decomposition: ${data.decomposition}`);
    detailsEl.textContent = detailParts.join(' · ');
    strokeViewer.setAttribute(
        'aria-label',
        data.character ? `Stroke order for ${data.character}` : 'Stroke order'
    );

    if (data.available === false) {
        state.animation.loadToken += 1;
        pauseAnimation();
        state.animation.strokes = [];
        state.animation.strokeIndex = 0;
        state.animation.lastTimestamp = null;
        strokeViewer.innerHTML = '';
        const missing = document.createElement('div');
        missing.className = 'empty-state';
        missing.textContent = 'This character is not present in the dataset yet.';
        strokeViewer.appendChild(missing);
        updateControls();
    }
}

async function loadCharacterDetail(character, options = {}) {
    if (!character) {
        return;
    }

    const { autoPlay = true } = options;

    const loadToken = ++state.animation.loadToken;
    pauseAnimation();
    state.animation.strokes = [];
    state.animation.strokeIndex = 0;
    state.animation.lastTimestamp = null;
    workspacePlaceholder.hidden = false;
    workspacePlaceholder.textContent = 'Loading character…';
    workspaceCard.hidden = true;
    strokeViewer.innerHTML = '';
    updateControls();

    try {
        const response = await fetch(`/api/character/${encodeURIComponent(character)}`);
        if (!response.ok) {
            throw new Error('Character lookup failed');
        }
        const data = await response.json();
        if (state.animation.loadToken !== loadToken) {
            return;
        }
        renderWorkspace(data);
        if (state.animation.loadToken !== loadToken) {
            return;
        }
        if (data.available === false) {
            return;
        }
        let initialized = await loadStrokeSvg(data, loadToken);
        if (state.animation.loadToken !== loadToken) {
            return;
        }
        if (!initialized) {
            initialized = setupFallbackStrokes(data.strokes || []);
        }
        if (state.animation.loadToken !== loadToken) {
            return;
        }
        if (initialized) {
            if (autoPlay) {
                startAnimation('play');
            } else {
                resetAnimation({ cancel: false });
            }
        } else {
            updateControls();
        }
    } catch (error) {
        console.error(error);
        clearWorkspace('Unable to load that character. Please try again.');
    }
}

function selectCandidate(index, options = {}) {
    if (index < 0 || index >= state.candidates.length) {
        return;
    }
    state.selectedIndex = index;
    renderCandidateList();
    const candidate = state.candidates[index];
    loadCharacterDetail(candidate.character, options);
}

async function handleQuery(rawValue) {
    const value = (rawValue || '').trim();
    if (!value) {
        setCandidates([], { emptyMessage: 'Enter Chinese characters or pinyin to begin.' });
        clearWorkspace();
        return;
    }

    try {
        if (containsCjk(value)) {
            const params = new URLSearchParams({ text: value });
            const response = await fetch(`/api/lookup?${params.toString()}`);
            if (!response.ok) {
                throw new Error('Lookup failed');
            }
            const payload = await response.json();
            const characters = payload.characters || [];
            setCandidates(characters, {
                autoSelect: characters.length > 0,
                autoPlay: true,
                emptyMessage: 'No Chinese characters were detected in the input.',
            });
        } else {
            const params = new URLSearchParams({ pinyin: value });
            const response = await fetch(`/api/search?${params.toString()}`);
            if (!response.ok) {
                throw new Error('Search failed');
            }
            const payload = await response.json();
            const characters = payload.characters || [];
            const emptyMessage = `No characters found for “${value}”.`;
            setCandidates(characters, {
                autoSelect: false,
                autoPlay: true,
                emptyMessage,
            });
            if (!characters.length) {
                clearWorkspace(emptyMessage);
            }
        }
    } catch (error) {
        console.error(error);
        setCandidates([], { emptyMessage: 'Unable to search right now. Please try again.' });
        clearWorkspace('Unable to search right now. Please try again.');
    }
}

async function performOcr(file) {
    if (!file) {
        ocrFeedback.textContent = 'Upload a photo to see OCR results.';
        setCandidates([], { emptyMessage: 'Upload a photo to see OCR results.' });
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
        const characters = payload.characters || [];
        if (payload.recognized_text) {
            ocrFeedback.textContent = `Recognized text: ${payload.recognized_text}`;
        } else {
            ocrFeedback.textContent = 'No Chinese characters detected.';
        }
        setCandidates(characters, {
            autoSelect: characters.length > 0,
            autoPlay: true,
            emptyMessage: 'No Chinese characters detected in that image.',
        });
    } catch (error) {
        console.error(error);
        ocrFeedback.textContent = 'We could not process that image. Try another photo.';
    }
}

queryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    handleQuery(queryInput.value || '');
});

queryInput.addEventListener('input', () => {
    clearTimeout(queryDebounce);
    queryDebounce = window.setTimeout(() => {
        handleQuery(queryInput.value || '');
    }, 300);
});

ocrForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const [file] = ocrInput.files || [];
    performOcr(file);
});

ocrInput.addEventListener('change', () => {
    const [file] = ocrInput.files || [];
    if (file) {
        performOcr(file);
    }
});

playButton.addEventListener('click', () => {
    playAnimation();
});

stepButton.addEventListener('click', () => {
    stepAnimation();
});

replayButton.addEventListener('click', () => {
    replayAnimation();
});

soundButton.addEventListener('click', () => {
    if (!state.currentCharacter) {
        return;
    }
    const hint = state.currentCharacter.pinyin ? state.currentCharacter.pinyin.join(', ') : '';
    speakCharacter(state.currentCharacter.character, hint);
});

copyButton.addEventListener('click', () => {
    if (!state.currentCharacter) {
        return;
    }
    copyToClipboard(state.currentCharacter.character);
});

// Initial state
setCandidates([], { emptyMessage: 'Enter Chinese characters or pinyin to begin.' });
clearWorkspace();
