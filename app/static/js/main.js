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
        paths: [],
        lengths: [],
        currentIndex: 0,
        isPlaying: false,
        cancelToken: 0,
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
    state.animation.cancelToken += 1;
    state.animation.paths = [];
    state.animation.lengths = [];
    state.animation.currentIndex = 0;
    state.animation.isPlaying = false;
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
    const hasStrokes = animation.paths.length > 0;
    const isComplete = hasStrokes && animation.currentIndex >= animation.paths.length;

    playButton.disabled = !hasCharacter || !hasStrokes || animation.isPlaying || isComplete;
    stepButton.disabled = !hasCharacter || !hasStrokes || animation.isPlaying || isComplete;
    replayButton.disabled = !hasCharacter || !hasStrokes;
    soundButton.disabled = !hasCharacter;
    copyButton.disabled = !hasCharacter;
}

function createStrokeSvg(strokes) {
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
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('stroke-width', '80');
        path.classList.add('workspace__stroke');
        strokeGroup.appendChild(path);
    });

    svg.appendChild(strokeGroup);
    return svg;
}

function resetAnimation(options = {}) {
    const { cancel = true } = options;
    if (cancel) {
        state.animation.cancelToken += 1;
    }
    state.animation.currentIndex = 0;
    state.animation.isPlaying = false;
    state.animation.paths.forEach((path, index) => {
        const length = state.animation.lengths[index];
        path.classList.remove('workspace__stroke--drawn', 'workspace__stroke--active');
        path.style.transition = 'none';
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${length}`;
        path.style.stroke = '#d43f5f';
        path.getBoundingClientRect();
        path.style.transition = '';
    });
    updateControls();
}

function setupStrokes(strokes) {
    state.animation.cancelToken += 1;
    state.animation.paths = [];
    state.animation.lengths = [];
    state.animation.currentIndex = 0;
    state.animation.isPlaying = false;
    strokeViewer.innerHTML = '';

    if (!strokes || !strokes.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Stroke order data is not available for this character yet.';
        strokeViewer.appendChild(empty);
        updateControls();
        return false;
    }

    const svg = createStrokeSvg(strokes);
    strokeViewer.innerHTML = '';
    strokeViewer.appendChild(svg);

    const paths = Array.from(svg.querySelectorAll('path.workspace__stroke'));
    paths.forEach((path) => {
        const length = path.getTotalLength();
        path.style.transition = 'none';
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${length}`;
        path.style.stroke = '#d43f5f';
        path.getBoundingClientRect();
        path.style.transition = '';
        state.animation.paths.push(path);
        state.animation.lengths.push(length);
    });

    resetAnimation({ cancel: false });
    return true;
}

function animateStroke(index, token) {
    const path = state.animation.paths[index];
    if (!path) {
        return Promise.resolve();
    }

    const length = state.animation.lengths[index];
    const duration = Math.min(Math.max(length / 600, 0.4), 1.2);

    return new Promise((resolve) => {
        let settled = false;

        const finish = (completed) => {
            if (settled) {
                return;
            }
            settled = true;
            path.removeEventListener('transitionend', handleTransition);
            path.classList.remove('workspace__stroke--active');
            if (completed) {
                path.classList.add('workspace__stroke--drawn');
                path.style.stroke = '#101828';
            }
            resolve();
        };

        const handleTransition = (event) => {
            if (event.propertyName !== 'stroke-dashoffset') {
                return;
            }
            const completed = token === state.animation.cancelToken;
            finish(completed);
        };

        path.classList.add('workspace__stroke--active');
        path.style.transition = 'none';
        path.style.strokeDasharray = `${length}`;
        path.style.strokeDashoffset = `${length}`;
        path.getBoundingClientRect();
        path.style.transition = `stroke-dashoffset ${duration}s ease-in-out`;
        path.addEventListener('transitionend', handleTransition);

        const monitorCancel = () => {
            if (settled) {
                return;
            }
            if (token !== state.animation.cancelToken) {
                finish(false);
                return;
            }
            requestAnimationFrame(monitorCancel);
        };

        requestAnimationFrame(() => {
            path.style.strokeDashoffset = '0';
            monitorCancel();
        });
    });
}

function playAnimation() {
    if (state.animation.isPlaying) {
        return;
    }
    if (state.animation.currentIndex >= state.animation.paths.length) {
        return;
    }

    const token = ++state.animation.cancelToken;
    state.animation.isPlaying = true;
    updateControls();

    (async () => {
        while (
            state.animation.currentIndex < state.animation.paths.length
            && token === state.animation.cancelToken
        ) {
            await animateStroke(state.animation.currentIndex, token);
            if (token !== state.animation.cancelToken) {
                return;
            }
            state.animation.currentIndex += 1;
        }
        if (token === state.animation.cancelToken) {
            state.animation.isPlaying = false;
            updateControls();
        }
    })();
}

function stepAnimation() {
    if (state.animation.isPlaying) {
        return;
    }
    if (state.animation.currentIndex >= state.animation.paths.length) {
        return;
    }

    const token = ++state.animation.cancelToken;
    state.animation.isPlaying = true;
    updateControls();

    animateStroke(state.animation.currentIndex, token).then(() => {
        if (token !== state.animation.cancelToken) {
            return;
        }
        state.animation.currentIndex += 1;
        state.animation.isPlaying = false;
        updateControls();
    });
}

function replayAnimation() {
    if (!state.currentCharacter) {
        return;
    }
    resetAnimation();
    playAnimation();
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
        state.animation.cancelToken += 1;
        state.animation.paths = [];
        state.animation.lengths = [];
        state.animation.currentIndex = 0;
        state.animation.isPlaying = false;
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

    state.animation.cancelToken += 1;
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
        renderWorkspace(data);
        if (data.available === false) {
            return;
        }
        const canAnimate = setupStrokes(data.strokes || []);
        if (canAnimate) {
            if (autoPlay) {
                playAnimation();
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
