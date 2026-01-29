let db = JSON.parse(localStorage.getItem('sig_scanner_v3')) || [];
let cropper = null;
let currentMode = 'upload';
let editingIndex = null;

// Variabili per gestire i risultati multipli della scansione
let matchResults = [];
let currentMatchPtr = 0;
let lastScannedImgData = null;

function showScreen(n) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${n}`).classList.add('active');
    if(n === 2) renderDatabase();
}

function startUploadFlow() {
    currentMode = 'upload';
    editingIndex = null;
    document.getElementById('editor-title').innerText = "Aggiungi Firma";
    document.getElementById('form-fields').classList.remove('hidden');
    document.getElementById('scan-action-btn').classList.add('hidden');
    resetEditor();
    showScreen(3);
}

function triggerFileSelect() {
    document.getElementById('file-input').click();
}

function handleFileChange(input, mode) {
    const file = input.files[0];
    if(!file) return;
    currentMode = mode;
    
    if(mode === 'scan') {
        document.getElementById('editor-title').innerText = "Ritaglia Firma Scansionata";
        document.getElementById('form-fields').classList.add('hidden');
        document.getElementById('scan-action-btn').classList.remove('hidden');
        showScreen(3);
    }

    const reader = new FileReader();
    reader.onload = (e) => initCropper(e.target.result);
    reader.readAsDataURL(file);
}

document.getElementById('file-input').onchange = (e) => handleFileChange(e.target, currentMode);

function initCropper(src) {
    const img = document.getElementById('image-to-crop');
    img.src = src;
    document.getElementById('upload-placeholder').classList.add('hidden');
    document.getElementById('crop-wrapper').classList.remove('hidden');
    if(cropper) cropper.destroy();
    cropper = new Cropper(img, { viewMode: 1, autoCropArea: 1 });
}

function resetEditor() {
    if(cropper) cropper.destroy();
    cropper = null;
    document.getElementById('upload-placeholder').classList.remove('hidden');
    document.getElementById('crop-wrapper').classList.add('hidden');
    document.getElementById('input-name').value = "";
    document.getElementById('input-surname').value = "";
}

function handleEditorAction() {
    if(!cropper) return alert("Carica e ritaglia un'immagine.");
    const croppedData = cropper.getCroppedCanvas({ width: 300 }).toDataURL('image/png');

    if(currentMode === 'upload') {
        const name = document.getElementById('input-name').value.trim();
        const surname = document.getElementById('input-surname').value.trim();
        if(!name || !surname) return alert("Inserisci dati completi.");
        
        const newEntry = { name, surname, signature: croppedData };
        if(editingIndex !== null) {
            db[editingIndex] = newEntry;
        } else {
            db.push(newEntry);
        }
        localStorage.setItem('sig_scanner_v3', JSON.stringify(db));
        showScreen(1);
    } else {
        runMatching(croppedData);
    }
}

function renderDatabase() {
    const list = document.getElementById('database-list');
    db.sort((a,b) => a.surname.localeCompare(b.surname));
    list.innerHTML = db.map((item, idx) => `
        <div class="list-item">
            <div class="db-name">${item.surname} ${item.name}</div>
            <div class="db-sig"><img src="${item.signature}"></div>
            <div class="actions">
                <button class="btn-action" onclick="editEntry(${idx})">✏️</button>
                <button class="btn-action" onclick="deleteEntry(${idx})">🗑️</button>
            </div>
        </div>
    `).join('');
}

function editEntry(idx) {
    editingIndex = idx;
    currentMode = 'upload';
    const item = db[idx];
    showScreen(3);
    document.getElementById('editor-title').innerText = "Modifica Profilo";
    document.getElementById('input-name').value = item.name;
    document.getElementById('input-surname').value = item.surname;
    document.getElementById('form-fields').classList.remove('hidden');
    document.getElementById('scan-action-btn').classList.add('hidden');
    initCropper(item.signature);
}

function deleteEntry(idx) {
    if(confirm("Eliminare definitivamente?")) {
        db.splice(idx, 1);
        localStorage.setItem('sig_scanner_v3', JSON.stringify(db));
        renderDatabase();
    }
}

// NUOVA LOGICA: Crea una lista di tutti i match ordinata per punteggio
async function runMatching(scannedImg) {
    if(db.length === 0) return alert("Database vuoto.");
    
    lastScannedImgData = scannedImg;
    matchResults = [];
    currentMatchPtr = 0;

    // Calcola il punteggio per OGNI elemento nel database
    for(let entry of db) {
        let score = await compare(scannedImg, entry.signature);
        matchResults.push({ ...entry, score });
    }

    // Ordina i risultati dal più alto al più basso
    matchResults.sort((a, b) => b.score - a.score);

    displayCurrentMatch();
}

// Funzione per mostrare il risultato basandosi sul puntatore attuale
function displayCurrentMatch() {
    if (matchResults.length === 0 || currentMatchPtr >= matchResults.length) {
        alert("Non ci sono altri risultati nel database.");
        return;
    }

    const currentMatch = matchResults[currentMatchPtr];
    
    document.getElementById('res-full-name').innerText = `${currentMatch.name} ${currentMatch.surname}`;
    document.getElementById('match-val').innerText = Math.round(currentMatch.score) + "%";
    document.getElementById('img-scanned').src = lastScannedImgData;
    document.getElementById('img-db').src = currentMatch.signature;
    
    showScreen(5);
}

// Funzione chiamata dal pulsante "Prova il prossimo"
function tryNextMatch() {
    currentMatchPtr++;
    displayCurrentMatch();
}

function compare(img1, img2) {
    return new Promise(resolve => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const size = 50; canvas.width = size; canvas.height = size;
        const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
        
        Promise.all([load(img1), load(img2)]).then(([i1, i2]) => {
            ctx.drawImage(i1, 0, 0, size, size);
            const d1 = ctx.getImageData(0,0,size,size).data;
            ctx.clearRect(0,0,size,size);
            ctx.drawImage(i2, 0, 0, size, size);
            const d2 = ctx.getImageData(0,0,size,size).data;
            
            let diff = 0;
            for(let i=0; i<d1.length; i+=4) {
                diff += Math.abs(d1[i] - d2[i]) + Math.abs(d1[i+1] - d2[i+1]) + Math.abs(d1[i+2] - d2[i+2]);
            }
            let score = 100 - (diff / (size * size * 3 * 255) * 100);
            resolve(Math.max(0, score)); 
        });
    });
}