/* ============================================================
   NovelVox — PDF to Audiobook Engine
   ============================================================ */

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─── LocalStorage Keys ────────────────────────────────────────

const STORAGE_KEYS = {
    recentBooks: 'novelvox_recent_books',
    settings: 'novelvox_settings',
};

const MAX_RECENT_BOOKS = 10;

// ─── State ────────────────────────────────────────────────────

const state = {
    chapters: [],          // Array of { title, text, sentences[] }
    currentChapter: 0,
    currentSentence: 0,
    isPlaying: false,
    voices: [],
    selectedVoice: null,
    speed: 1,
    pitch: 1,
    fileName: '',
    totalPages: 0,
    utterance: null,
    fileHash: '',          // Hash to identify the PDF for resume
};

// ─── DOM References ───────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
    uploadScreen:    $('upload-screen'),
    loadingScreen:   $('loading-screen'),
    playerScreen:    $('player-screen'),
    dropZone:        $('drop-zone'),
    fileInput:       $('file-input'),
    loadingStatus:   $('loading-status'),
    progressBar:     $('progress-bar'),
    progressText:    $('progress-text'),
    chapterList:     $('chapter-list'),
    textContent:     $('text-content'),
    textDisplay:     $('text-display'),
    bookTitle:       $('book-title'),
    bookPages:       $('book-pages'),
    btnPlay:         $('btn-play'),
    iconPlay:        $('icon-play'),
    iconPause:       $('icon-pause'),
    btnPrev:         $('btn-prev-chapter'),
    btnNext:         $('btn-next-chapter'),
    btnRewind:       $('btn-rewind'),
    btnForward:      $('btn-forward'),
    voiceSelect:     $('voice-select'),
    speedRange:      $('speed-range'),
    speedValue:      $('speed-value'),
    pitchRange:      $('pitch-range'),
    pitchValue:      $('pitch-value'),
    seekBarContainer:$('seek-bar-container'),
    seekBarFill:     $('seek-bar-fill'),
    currentChapterLabel: $('current-chapter-label'),
    chapterProgressLabel: $('chapter-progress-label'),
    recentBooks:     $('recent-books'),
    recentList:      $('recent-list'),
};

// ─── Persistence Helpers ──────────────────────────────────────

function getRecentBooks() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.recentBooks)) || [];
    } catch { return []; }
}

function saveRecentBooks(books) {
    localStorage.setItem(STORAGE_KEYS.recentBooks, JSON.stringify(books));
}

function getSavedSettings() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.settings)) || {};
    } catch { return {}; }
}

function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

// Generate a simple hash from file name + size for identifying the same PDF
function generateFileHash(file) {
    return `${file.name}_${file.size}`;
}

// Save current reading progress to localStorage
function saveProgress() {
    if (!state.fileHash || state.chapters.length === 0) return;

    const books = getRecentBooks();
    const existingIndex = books.findIndex(b => b.hash === state.fileHash);

    const bookData = {
        hash: state.fileHash,
        name: state.fileName,
        totalPages: state.totalPages,
        totalChapters: state.chapters.length,
        currentChapter: state.currentChapter,
        currentSentence: state.currentSentence,
        lastOpened: Date.now(),
    };

    if (existingIndex >= 0) {
        books[existingIndex] = bookData;
    } else {
        books.unshift(bookData);
    }

    // Keep only the most recent books
    saveRecentBooks(books.slice(0, MAX_RECENT_BOOKS));

    // Save global settings (voice, speed, pitch)
    saveSettings({
        voiceName: state.selectedVoice?.name || '',
        speed: state.speed,
        pitch: state.pitch,
    });
}

// Load saved settings (voice, speed, pitch) from localStorage
function loadSavedSettings() {
    const settings = getSavedSettings();
    if (settings.speed) {
        state.speed = settings.speed;
        dom.speedRange.value = settings.speed;
        dom.speedValue.textContent = settings.speed.toFixed(1) + 'x';
    }
    if (settings.pitch) {
        state.pitch = settings.pitch;
        dom.pitchRange.value = settings.pitch;
        dom.pitchValue.textContent = settings.pitch.toFixed(1);
    }
}

// Get saved position for a specific book
function getSavedPosition(fileHash) {
    const books = getRecentBooks();
    return books.find(b => b.hash === fileHash) || null;
}

// ─── Recent Books UI ──────────────────────────────────────────

function renderRecentBooks() {
    const books = getRecentBooks();

    if (books.length === 0) {
        dom.recentBooks.style.display = 'none';
        return;
    }

    dom.recentBooks.style.display = '';
    dom.recentList.innerHTML = '';

    books.forEach((book, idx) => {
        const chapterPct = book.totalChapters > 0
            ? Math.round(((book.currentChapter) / book.totalChapters) * 100)
            : 0;

        const timeAgo = formatTimeAgo(book.lastOpened);

        const el = document.createElement('div');
        el.className = 'recent-item';
        el.innerHTML = `
            <div class="recent-item-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                </svg>
            </div>
            <div class="recent-item-info">
                <div class="recent-item-name">${escapeHtml(book.name)}</div>
                <div class="recent-item-meta">
                    <span>Ch. ${book.currentChapter + 1}/${book.totalChapters}</span>
                    <span>·</span>
                    <span>${timeAgo}</span>
                </div>
            </div>
            <div class="recent-item-progress">
                <div class="recent-progress-bar">
                    <div class="recent-progress-fill" style="width: ${chapterPct}%"></div>
                </div>
                <span class="recent-progress-text">${chapterPct}%</span>
            </div>
            <button class="recent-item-remove" title="Remove from history" data-idx="${idx}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        // Click to prompt re-upload of same file
        el.addEventListener('click', (e) => {
            if (e.target.closest('.recent-item-remove')) return;
            // Trigger file input — user must select the same file again
            dom.fileInput.click();
        });

        // Remove button
        el.querySelector('.recent-item-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            const allBooks = getRecentBooks();
            allBooks.splice(idx, 1);
            saveRecentBooks(allBooks);
            renderRecentBooks();
        });

        dom.recentList.appendChild(el);
    });
}

function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── Screen Management ────────────────────────────────────────

function showScreen(name) {
    [dom.uploadScreen, dom.loadingScreen, dom.playerScreen].forEach(s =>
        s.classList.remove('active')
    );
    const screens = {
        upload: dom.uploadScreen,
        loading: dom.loadingScreen,
        player: dom.playerScreen,
    };
    screens[name].classList.add('active');
}

// ─── File Upload / Drop ───────────────────────────────────────

dom.dropZone.addEventListener('click', () => dom.fileInput.click());

dom.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

dom.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.dropZone.classList.add('drag-over');
});

dom.dropZone.addEventListener('dragleave', () => {
    dom.dropZone.classList.remove('drag-over');
});

dom.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        handleFile(file);
    }
});

// ─── PDF Processing ───────────────────────────────────────────

async function handleFile(file) {
    state.fileName = file.name.replace(/\.pdf$/i, '');
    state.fileHash = generateFileHash(file);
    showScreen('loading');

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        state.totalPages = pdf.numPages;
        dom.loadingStatus.textContent = `Reading ${pdf.numPages} pages...`;

        const allText = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            allText.push(pageText);

            const pct = Math.round((i / pdf.numPages) * 100);
            dom.progressBar.style.width = pct + '%';
            dom.progressText.textContent = pct + '%';
            dom.loadingStatus.textContent = `Page ${i} of ${pdf.numPages}...`;
        }

        const fullText = allText.join('\n\n');
        parseChapters(fullText);
        initPlayer();

    } catch (err) {
        console.error('PDF processing error:', err);
        dom.loadingStatus.textContent = 'Error reading PDF. Please try another file.';
    }
}

// ─── Chapter Parsing ──────────────────────────────────────────

function parseChapters(text) {
    // Common light novel chapter patterns
    const chapterRegex = /(?:^|\n)\s*((?:Chapter|CHAPTER|Ch\.?|Prologue|Epilogue|Interlude|Afterword|Foreword|Preface|Volume|VOLUME|Part)\s*[\d.:IVXLC]*[^\n]{0,80})/gi;

    const matches = [...text.matchAll(chapterRegex)];
    const chapters = [];

    if (matches.length > 1) {
        for (let i = 0; i < matches.length; i++) {
            const start = matches[i].index;
            const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
            const title = matches[i][1].trim();
            const body = text.slice(start + matches[i][0].length, end).trim();
            if (body.length > 20) {
                chapters.push({ title, text: body });
            }
        }
    }

    // Fallback: split into ~2000 word chunks if no chapters found
    if (chapters.length === 0) {
        const words = text.split(/\s+/);
        const chunkSize = 2000;
        let chapterNum = 1;
        for (let i = 0; i < words.length; i += chunkSize) {
            const chunk = words.slice(i, i + chunkSize).join(' ');
            if (chunk.trim().length > 20) {
                chapters.push({
                    title: `Section ${chapterNum}`,
                    text: chunk.trim()
                });
                chapterNum++;
            }
        }
    }

    // Split each chapter into sentences
    chapters.forEach(ch => {
        ch.sentences = splitSentences(ch.text);
    });

    state.chapters = chapters;
}

function splitSentences(text) {
    // Split on sentence endings followed by spaces, preserving dialogue
    const raw = text.match(/[^.!?…]+[.!?…]+[\s"'」』）)】\]]*|[^.!?…]+$/g) || [text];
    return raw
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

// ─── Player Initialization ───────────────────────────────────

function initPlayer() {
    dom.bookTitle.textContent = state.fileName;
    dom.bookPages.textContent = `${state.totalPages} pages · ${state.chapters.length} chapters`;

    renderChapterList();

    // Restore saved position if available
    const savedPos = getSavedPosition(state.fileHash);
    if (savedPos && savedPos.currentChapter < state.chapters.length) {
        loadChapter(savedPos.currentChapter);
        const chapter = state.chapters[savedPos.currentChapter];
        if (savedPos.currentSentence < chapter.sentences.length) {
            state.currentSentence = savedPos.currentSentence;
            highlightSentence(savedPos.currentSentence);
            // Mark previous sentences as spoken
            for (let i = 0; i < savedPos.currentSentence; i++) {
                markSpoken(i);
            }
            updateProgress();
        }
    } else {
        loadChapter(0);
    }

    loadVoices();
    showScreen('player');

    // Save that we opened this book
    saveProgress();
}

function renderChapterList() {
    dom.chapterList.innerHTML = '';
    state.chapters.forEach((ch, i) => {
        const el = document.createElement('div');
        el.className = 'chapter-item' + (i === state.currentChapter ? ' active' : '');
        el.innerHTML = `<span class="chapter-number">${String(i + 1).padStart(2, '0')}</span>${ch.title}`;
        el.addEventListener('click', () => {
            stopSpeech();
            loadChapter(i);
            if (state.isPlaying) startSpeech();
        });
        dom.chapterList.appendChild(el);
    });
}

function loadChapter(index) {
    if (index < 0 || index >= state.chapters.length) return;

    state.currentChapter = index;
    state.currentSentence = 0;

    const chapter = state.chapters[index];
    dom.currentChapterLabel.textContent = chapter.title;

    // Render sentences
    dom.textContent.innerHTML = '';
    chapter.sentences.forEach((sentence, i) => {
        const span = document.createElement('span');
        span.className = 'sentence';
        span.textContent = sentence + ' ';
        span.dataset.index = i;
        span.addEventListener('click', () => {
            stopSpeech();
            state.currentSentence = i;
            if (state.isPlaying) startSpeech();
            highlightSentence(i);
        });
        dom.textContent.appendChild(span);
    });

    // Update sidebar
    document.querySelectorAll('.chapter-item').forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });

    // Scroll sidebar to active
    const activeItem = document.querySelector('.chapter-item.active');
    if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    updateProgress();
    dom.textDisplay.scrollTop = 0;

    // Save progress when changing chapters
    saveProgress();
}

// ─── Voice Loading ────────────────────────────────────────────

function loadVoices() {
    const populateVoices = () => {
        state.voices = speechSynthesis.getVoices();
        dom.voiceSelect.innerHTML = '';

        // Prioritize English voices
        const sorted = [...state.voices].sort((a, b) => {
            const aEn = a.lang.startsWith('en');
            const bEn = b.lang.startsWith('en');
            if (aEn && !bEn) return -1;
            if (!aEn && bEn) return 1;
            return a.name.localeCompare(b.name);
        });

        sorted.forEach((voice, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${voice.name} (${voice.lang})`;
            dom.voiceSelect.appendChild(opt);
        });

        state.voices = sorted;

        // Determine which voice to select:
        // 1. Previously saved voice (from settings)
        // 2. "Samantha" as default
        // 3. First available voice
        const savedSettings = getSavedSettings();
        let selectedIndex = -1;

        if (savedSettings.voiceName) {
            selectedIndex = sorted.findIndex(v => v.name === savedSettings.voiceName);
        }

        if (selectedIndex < 0) {
            // Default to Samantha (macOS built-in)
            selectedIndex = sorted.findIndex(v =>
                v.name.toLowerCase().includes('samantha')
            );
        }

        if (selectedIndex < 0 && sorted.length > 0) {
            selectedIndex = 0;
        }

        if (selectedIndex >= 0) {
            state.selectedVoice = sorted[selectedIndex];
            dom.voiceSelect.value = selectedIndex;
        }
    };

    populateVoices();
    speechSynthesis.onvoiceschanged = populateVoices;
}

// ─── Speech Synthesis ─────────────────────────────────────────

function startSpeech() {
    if (state.chapters.length === 0) return;

    const chapter = state.chapters[state.currentChapter];
    if (state.currentSentence >= chapter.sentences.length) {
        // Move to next chapter
        if (state.currentChapter < state.chapters.length - 1) {
            loadChapter(state.currentChapter + 1);
            startSpeech();
        } else {
            pauseSpeech();
        }
        return;
    }

    const sentence = chapter.sentences[state.currentSentence];
    const utterance = new SpeechSynthesisUtterance(sentence);
    state.utterance = utterance;

    if (state.selectedVoice) utterance.voice = state.selectedVoice;
    utterance.rate = state.speed;
    utterance.pitch = state.pitch;

    utterance.onstart = () => {
        highlightSentence(state.currentSentence);
    };

    utterance.onend = () => {
        markSpoken(state.currentSentence);
        state.currentSentence++;
        updateProgress();
        saveProgress(); // Auto-save progress
        if (state.isPlaying) {
            startSpeech();
        }
    };

    utterance.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
            console.warn('Speech error:', e.error);
            state.currentSentence++;
            if (state.isPlaying) startSpeech();
        }
    };

    speechSynthesis.speak(utterance);
}

function stopSpeech() {
    speechSynthesis.cancel();
}

function pauseSpeech() {
    state.isPlaying = false;
    stopSpeech();
    dom.iconPlay.style.display = '';
    dom.iconPause.style.display = 'none';
    saveProgress(); // Save on pause
}

function resumeSpeech() {
    state.isPlaying = true;
    dom.iconPlay.style.display = 'none';
    dom.iconPause.style.display = '';
    startSpeech();
}

// ─── Highlighting ─────────────────────────────────────────────

function highlightSentence(index) {
    document.querySelectorAll('.sentence').forEach(el => {
        el.classList.remove('active');
    });

    const el = document.querySelector(`.sentence[data-index="${index}"]`);
    if (el) {
        el.classList.add('active');
        // Smooth scroll into view
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function markSpoken(index) {
    const el = document.querySelector(`.sentence[data-index="${index}"]`);
    if (el) {
        el.classList.remove('active');
        el.classList.add('spoken');
    }
}

function updateProgress() {
    const chapter = state.chapters[state.currentChapter];
    if (!chapter) return;

    const total = chapter.sentences.length;
    const current = state.currentSentence;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;

    dom.seekBarFill.style.width = pct + '%';
    dom.chapterProgressLabel.textContent = pct + '%';
}

// ─── Controls ─────────────────────────────────────────────────

dom.btnPlay.addEventListener('click', () => {
    if (state.isPlaying) {
        pauseSpeech();
    } else {
        resumeSpeech();
    }
});

dom.btnPrev.addEventListener('click', () => {
    stopSpeech();
    if (state.currentChapter > 0) {
        loadChapter(state.currentChapter - 1);
        if (state.isPlaying) startSpeech();
    }
});

dom.btnNext.addEventListener('click', () => {
    stopSpeech();
    if (state.currentChapter < state.chapters.length - 1) {
        loadChapter(state.currentChapter + 1);
        if (state.isPlaying) startSpeech();
    }
});

dom.btnRewind.addEventListener('click', () => {
    stopSpeech();
    state.currentSentence = Math.max(0, state.currentSentence - 5);
    updateProgress();
    if (state.isPlaying) startSpeech();
    else highlightSentence(state.currentSentence);
});

dom.btnForward.addEventListener('click', () => {
    const chapter = state.chapters[state.currentChapter];
    stopSpeech();
    state.currentSentence = Math.min(chapter.sentences.length - 1, state.currentSentence + 5);
    updateProgress();
    if (state.isPlaying) startSpeech();
    else highlightSentence(state.currentSentence);
});

// Seek bar click
dom.seekBarContainer.addEventListener('click', (e) => {
    const rect = dom.seekBarContainer.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const chapter = state.chapters[state.currentChapter];
    const newIndex = Math.floor(pct * chapter.sentences.length);

    stopSpeech();
    state.currentSentence = Math.max(0, Math.min(newIndex, chapter.sentences.length - 1));
    updateProgress();

    // Reset visual state
    document.querySelectorAll('.sentence').forEach((el, i) => {
        el.classList.remove('active', 'spoken');
        if (i < state.currentSentence) el.classList.add('spoken');
    });

    if (state.isPlaying) startSpeech();
    else highlightSentence(state.currentSentence);
});

// Voice selection
dom.voiceSelect.addEventListener('change', (e) => {
    state.selectedVoice = state.voices[e.target.value];
    saveSettings({
        voiceName: state.selectedVoice?.name || '',
        speed: state.speed,
        pitch: state.pitch,
    });
    if (state.isPlaying) {
        stopSpeech();
        startSpeech();
    }
});

// Speed
dom.speedRange.addEventListener('input', (e) => {
    state.speed = parseFloat(e.target.value);
    dom.speedValue.textContent = state.speed.toFixed(1) + 'x';
    saveSettings({
        voiceName: state.selectedVoice?.name || '',
        speed: state.speed,
        pitch: state.pitch,
    });
    if (state.isPlaying) {
        stopSpeech();
        startSpeech();
    }
});

// Pitch
dom.pitchRange.addEventListener('input', (e) => {
    state.pitch = parseFloat(e.target.value);
    dom.pitchValue.textContent = state.pitch.toFixed(1);
    saveSettings({
        voiceName: state.selectedVoice?.name || '',
        speed: state.speed,
        pitch: state.pitch,
    });
    if (state.isPlaying) {
        stopSpeech();
        startSpeech();
    }
});

// ─── Keyboard Shortcuts ──────────────────────────────────────

document.addEventListener('keydown', (e) => {
    // Only on player screen
    if (!dom.playerScreen.classList.contains('active')) return;

    switch (e.code) {
        case 'Space':
            e.preventDefault();
            dom.btnPlay.click();
            break;
        case 'ArrowLeft':
            e.preventDefault();
            dom.btnRewind.click();
            break;
        case 'ArrowRight':
            e.preventDefault();
            dom.btnForward.click();
            break;
        case 'ArrowUp':
            e.preventDefault();
            dom.speedRange.value = Math.min(3, parseFloat(dom.speedRange.value) + 0.1);
            dom.speedRange.dispatchEvent(new Event('input'));
            break;
        case 'ArrowDown':
            e.preventDefault();
            dom.speedRange.value = Math.max(0.5, parseFloat(dom.speedRange.value) - 0.1);
            dom.speedRange.dispatchEvent(new Event('input'));
            break;
    }
});

// ─── Save on page unload ─────────────────────────────────────

window.addEventListener('beforeunload', () => {
    saveProgress();
});

// ─── Keep Speech Alive (Chrome bug workaround) ───────────────
// Chrome pauses speech after ~15 seconds; this workaround resumes it.

setInterval(() => {
    if (state.isPlaying && speechSynthesis.paused) {
        speechSynthesis.resume();
    }
}, 5000);

// ─── Init ────────────────────────────────────────────────────

loadSavedSettings();
renderRecentBooks();
showScreen('upload');
