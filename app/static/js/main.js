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
const playButton = document.getElementById('btn-play');
const stepButton = document.getElementById('btn-step');
const replayButton = document.getElementById('btn-replay');
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
        isAnimating: false,
        isStepping: false,
        rafId: null,
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
    stopPlayback();
    state.animation.strokes = [];
    state.animation.strokeIndex = 0;
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
    updateButtons();
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
            updateButtons();
        }
        return;
    }

    if (autoSelect) {
        selectCandidate(0, { autoPlay });
    } else {
        updateButtons();
    }
}

function cancelAnimationLoop() {
    const anim = state.animation;
    if (anim.rafId !== null) {
        cancelAnimationFrame(anim.rafId);
        anim.rafId = null;
    }
}

function stopPlayback() {
    const anim = state.animation;
    anim.isAnimating = false;
    anim.isStepping = false;
    cancelAnimationLoop();
}

function setStrokeProgress(stroke, progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    stroke.progress = clamped;
    if (stroke.revealPath) {
        stroke.revealPath.style.strokeDashoffset = `${stroke.length * (1 - clamped)}`;
    }
}

function updateButtons() {
    const hasCharacter = Boolean(state.currentCharacter);
    const anim = state.animation;
    const hasStrokes = anim.strokes.length > 0;
    const isComplete = hasStrokes && anim.strokeIndex >= anim.strokes.length;
    const isBusy = anim.isAnimating || anim.isStepping;

    playButton.textContent = anim.isAnimating ? 'Stop' : 'Play';
    playButton.disabled = !hasCharacter || !hasStrokes || isComplete;
    stepButton.disabled = !hasCharacter || !hasStrokes || isComplete || isBusy;
    replayButton.disabled = !hasCharacter || !hasStrokes;
    soundButton.disabled = !hasCharacter;
    copyButton.disabled = !hasCharacter;
}

function createStrokeSvg(strokes, medians, strokeWidth) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 1024 1024');
    svg.classList.add('workspace__svg');

    const defs = document.createElementNS(svgNS, 'defs');
    svg.appendChild(defs);

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

    const transform = 'scale(1, -1) translate(0, -900)';
    const strokeGroup = document.createElementNS(svgNS, 'g');
    strokeGroup.setAttribute('transform', transform);

    const strokeInfos = [];

    strokes.forEach((data, index) => {
        if (!data) {
            return;
        }

        const fillPath = document.createElementNS(svgNS, 'path');
        fillPath.setAttribute('d', data);
        fillPath.setAttribute('fill', '#101828');
        fillPath.setAttribute('stroke', 'none');

        const medianPoints = Array.isArray(medians?.[index]) ? medians[index] : [];

        if (medianPoints.length > 0) {
            const maskId = `reveal-mask-${index}-${Math.random().toString(36).slice(2)}`;
            const mask = document.createElementNS(svgNS, 'mask');
            mask.setAttribute('id', maskId);
            mask.setAttribute('maskUnits', 'userSpaceOnUse');

            const maskRect = document.createElementNS(svgNS, 'rect');
            maskRect.setAttribute('x', '0');
            maskRect.setAttribute('y', '0');
            maskRect.setAttribute('width', '1024');
            maskRect.setAttribute('height', '1024');
            maskRect.setAttribute('fill', '#000');
            mask.appendChild(maskRect);

            const maskGroup = document.createElementNS(svgNS, 'g');
            maskGroup.setAttribute('transform', transform);

            const revealPath = document.createElementNS(svgNS, 'path');
            const medianPathData = medianPoints
                .map((point, pointIndex) => {
                    const [x, y] = point;
                    const command = pointIndex === 0 ? 'M' : 'L';
                    return `${command} ${x} ${y}`;
                })
                .join(' ');
            revealPath.setAttribute('d', medianPathData);
            revealPath.setAttribute('fill', 'none');
            revealPath.setAttribute('stroke', '#fff');
            revealPath.setAttribute('stroke-linecap', 'round');
            revealPath.setAttribute('stroke-linejoin', 'round');
            revealPath.setAttribute('vector-effect', 'non-scaling-stroke');
            revealPath.setAttribute('stroke-width', `${strokeWidth}`);
            maskGroup.appendChild(revealPath);

            mask.appendChild(maskGroup);
            defs.appendChild(mask);

            fillPath.setAttribute('mask', `url(#${maskId})`);
            strokeInfos.push({ fillPath, revealPath });
        } else {
            strokeInfos.push({ fillPath, revealPath: null });
        }

        strokeGroup.appendChild(fillPath);
    });

    svg.appendChild(strokeGroup);
    return { svg, strokeInfos };
}

function resetAnimation(options = {}) {
    const { cancel = true } = options;
    if (cancel) {
        stopPlayback();
    }
    const anim = state.animation;
    anim.strokeIndex = 0;
    anim.strokes.forEach((stroke) => {
        if (stroke.revealPath) {
            stroke.revealPath.style.strokeDasharray = `${stroke.length}`;
            stroke.revealPath.style.strokeDashoffset = `${stroke.length}`;
            stroke.progress = 0;
        } else {
            stroke.progress = 1;
        }
    });
    updateButtons();
}

function setupStrokes(strokes, medians = []) {
    stopPlayback();
    const anim = state.animation;
    anim.strokes = [];
    anim.strokeIndex = 0;
    strokeViewer.innerHTML = '';

    if (!strokes || !strokes.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Stroke order data is not available for this character yet.';
        strokeViewer.appendChild(empty);
        updateButtons();
        return false;
    }

    const rootStyles = getComputedStyle(document.documentElement);
    const cssValue = parseFloat(
        rootStyles.getPropertyValue('--reveal-stroke-width') || '120'
    );
    const revealWidth = Number.isFinite(cssValue) ? cssValue : 120;
    const viewerRect = strokeViewer.getBoundingClientRect();
    const svgSize = viewerRect.width || viewerRect.height || 512;
    const strokeWidth = (svgSize / 1024) * revealWidth;

    const { svg, strokeInfos } = createStrokeSvg(strokes, medians, strokeWidth);
    strokeViewer.appendChild(svg);

    strokeInfos.forEach(({ fillPath, revealPath }) => {
        if (revealPath) {
            const length = revealPath.getTotalLength();
            revealPath.style.strokeDasharray = `${length}`;
            revealPath.style.strokeDashoffset = `${length}`;
            anim.strokes.push({
                fillPath,
                revealPath,
                length,
                duration: Math.min(Math.max(length / 600, 0.4), 1.2) * 1000,
                progress: 0,
            });
        } else {
            anim.strokes.push({
                fillPath,
                revealPath: null,
                length: 0,
                duration: 0,
                progress: 1,
            });
        }
    });

    resetAnimation({ cancel: false });
    return true;
}

function animateSingleStroke(index, onDone) {
    const anim = state.animation;
    const stroke = anim.strokes[index];
    if (!stroke) {
        if (typeof onDone === 'function') {
            onDone();
        }
        return;
    }

    cancelAnimationLoop();

    if (!stroke.revealPath) {
        stroke.progress = 1;
        if (typeof onDone === 'function') {
            onDone();
        }
        return;
    }

    const { duration } = stroke;
    const startProgress = stroke.progress || 0;
    if (startProgress >= 1) {
        if (typeof onDone === 'function') {
            onDone();
        }
        return;
    }

    setStrokeProgress(stroke, startProgress);

    let startTime = null;

    const step = (timestamp) => {
        if (startTime === null) {
            startTime = timestamp - startProgress * duration;
        }
        const elapsed = Math.max(timestamp - startTime, 0);
        const progress = Math.min(elapsed / duration, 1);
        setStrokeProgress(stroke, progress);

        if (progress >= 1) {
            anim.rafId = null;
            if (typeof onDone === 'function') {
                onDone();
            }
            return;
        }

        if (!anim.isAnimating && !anim.isStepping) {
            anim.rafId = null;
            return;
        }

        anim.rafId = requestAnimationFrame(step);
    };

    anim.rafId = requestAnimationFrame(step);
}

function advanceStrokeIndex() {
    const anim = state.animation;
    while (
        anim.strokeIndex < anim.strokes.length
        && anim.strokes[anim.strokeIndex].progress >= 1
    ) {
        anim.strokeIndex += 1;
    }
}

function runAutoLoop() {
    const anim = state.animation;
    advanceStrokeIndex();
    if (!anim.isAnimating) {
        updateButtons();
        return;
    }
    if (anim.strokeIndex >= anim.strokes.length) {
        anim.isAnimating = false;
        updateButtons();
        return;
    }

    animateSingleStroke(anim.strokeIndex, () => {
        anim.strokes[anim.strokeIndex].progress = 1;
        anim.strokeIndex += 1;
        if (anim.isAnimating) {
            runAutoLoop();
        } else {
            updateButtons();
        }
    });
}

function togglePlay() {
    const anim = state.animation;
    if (anim.isStepping) {
        return;
    }
    if (!state.currentCharacter || !anim.strokes.length) {
        return;
    }
    if (anim.isAnimating) {
        stopPlayback();
        updateButtons();
        return;
    }
    advanceStrokeIndex();
    if (anim.strokeIndex >= anim.strokes.length) {
        updateButtons();
        return;
    }
    anim.isAnimating = true;
    anim.isStepping = false;
    updateButtons();
    runAutoLoop();
}

function stepAnimation() {
    const anim = state.animation;
    if (anim.isAnimating || anim.isStepping) {
        return;
    }
    if (!state.currentCharacter || !anim.strokes.length) {
        return;
    }

    advanceStrokeIndex();
    if (anim.strokeIndex >= anim.strokes.length) {
        updateButtons();
        return;
    }

    anim.isStepping = true;
    updateButtons();
    animateSingleStroke(anim.strokeIndex, () => {
        anim.strokes[anim.strokeIndex].progress = 1;
        anim.strokeIndex += 1;
        anim.isStepping = false;
        updateButtons();
    });
}

function replayAnimation() {
    if (!state.currentCharacter || !state.animation.strokes.length) {
        return;
    }
    resetAnimation();
    const anim = state.animation;
    anim.isAnimating = true;
    updateButtons();
    runAutoLoop();
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
        stopPlayback();
        state.animation.strokes = [];
        state.animation.strokeIndex = 0;
        strokeViewer.innerHTML = '';
        const missing = document.createElement('div');
        missing.className = 'empty-state';
        missing.textContent = 'This character is not present in the dataset yet.';
        strokeViewer.appendChild(missing);
        updateButtons();
    }
}

async function loadCharacterDetail(character, options = {}) {
    if (!character) {
        return;
    }

    const { autoPlay = true } = options;

    stopPlayback();
    state.animation.strokes = [];
    state.animation.strokeIndex = 0;
    workspacePlaceholder.hidden = false;
    workspacePlaceholder.textContent = 'Loading character…';
    workspaceCard.hidden = true;
    strokeViewer.innerHTML = '';
    updateButtons();

    try {
        const response = await fetch(`/api/character/${encodeURIComponent(character)}`);
        if (!response.ok) {
            throw new Error('Character lookup failed');
        }
        const data = await response.json();
        renderWorkspace(data);
        if (data.available === false) {
            return;
        }
        const canAnimate = setupStrokes(data.strokes || [], data.medians || []);
        if (canAnimate) {
            if (autoPlay) {
                replayAnimation();
            } else {
                resetAnimation();
            }
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
    togglePlay();
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
