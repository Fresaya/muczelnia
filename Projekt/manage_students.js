// Config
const supabaseUrl = 'https://xzbonbdtfgrhihwmiamq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6Ym9uYmR0ZmdyaGlod21pYW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxNDYxMzAsImV4cCI6MjA3OTcyMjEzMH0.iqd1FO3kdgECw857Okf0CF_i570wcTk2VtJhJXSwlEg'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// State
let schoolsCache = [];
let currentRole = null;
let allStudents = []; 
let allClasses = []; 

// Init & Auth
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: user } = await _supabase.from('users').select('role, school_id').eq('id', session.user.id).single();
    if (!['admin', 'manager', 'lecturer'].includes(user.role)) {
        alert("Brak dostępu."); window.location.href = 'dashboard.html'; return;
    }
    currentRole = user.role;

    await loadSchools(user);

    document.getElementById('filter-level').addEventListener('change', filterSchoolsByLevel);
    document.getElementById('filter-school').addEventListener('change', function() { loadStudents(this.value); });
    
    document.getElementById('filter-class').addEventListener('change', applyFilters);
    document.getElementById('search-student').addEventListener('input', applyFilters);
});

// Data Loading
async function loadSchools(user) {
    let query = _supabase.from('schools').select('id, name, level').order('name');
    
    if (currentRole !== 'admin') {
        query = query.eq('id', user.school_id);
        const { data } = await query;
        if(data && data.length > 0) {
            schoolsCache = data;
            const s = data[0];
            
            const lvlSelect = document.getElementById('filter-level');
            lvlSelect.value = s.level;
            lvlSelect.disabled = true; 
            
            const schSelect = document.getElementById('filter-school');
            schSelect.innerHTML = `<option value="${s.id}">${s.name}</option>`;
            schSelect.disabled = true; 
            
            loadStudents(s.id); 
        }
    } else {
        const { data } = await query;
        schoolsCache = data || [];
    }
}

function filterSchoolsByLevel() {
    const lvl = document.getElementById('filter-level').value;
    const sSelect = document.getElementById('filter-school');
    sSelect.innerHTML = '<option value="" disabled selected>-- Wybierz Szkołę --</option>';
    
    const filtered = (lvl === 'all') ? schoolsCache : schoolsCache.filter(s => s.level == lvl);
    
    filtered.forEach(s => {
        sSelect.add(new Option(s.name, s.id));
    });
    sSelect.disabled = false;
}

async function loadStudents(schoolId) {
    const tbody = document.getElementById('students-body');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Ładowanie listy...</td></tr>';

    const { data: students, error } = await _supabase
        .from('users')
        .select('id, username, email, class_id')
        .eq('school_id', schoolId)
        .eq('role', 'student')
        .order('username');

    const { data: classes } = await _supabase
        .from('classes')
        .select('id, name')
        .eq('school_id', schoolId)
        .order('name');

    if (error) { alert("Błąd: " + error.message); return; }
    
    allStudents = students || [];
    allClasses = classes || [];

    populateClassFilter(allClasses);
    applyFilters();
}

// Rendering & Filtering
function populateClassFilter(classesList) {
    const classFilter = document.getElementById('filter-class');
    classFilter.innerHTML = '<option value="all">Wszystkie Klasy</option>';
    classFilter.innerHTML += '<option value="none">Bez Klasy (Nieprzypisani)</option>';
    
    if(classesList.length > 0) {
        classesList.forEach(c => {
            classFilter.add(new Option(c.name, c.id));
        });
        classFilter.disabled = false;
    } else {
        classFilter.disabled = true;
    }
}

function applyFilters() {
    const classVal = document.getElementById('filter-class').value;
    const searchVal = document.getElementById('search-student').value.toLowerCase();

    const filtered = allStudents.filter(s => {
        let matchClass = true;
        if (classVal === 'all') matchClass = true;
        else if (classVal === 'none') matchClass = (s.class_id === null);
        else matchClass = (s.class_id == classVal);

        const name = s.username ? s.username.toLowerCase() : "";
        const email = s.email ? s.email.toLowerCase() : "";
        const matchSearch = name.includes(searchVal) || email.includes(searchVal);

        return matchClass && matchSearch;
    });

    renderTable(filtered, allClasses);
}

function renderTable(studentsList, classesList) {
    const tbody = document.getElementById('students-body');
    tbody.innerHTML = '';

    if (studentsList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Brak uczniów spełniających kryteria.</td></tr>';
        return;
    }

    studentsList.forEach(s => {
        const tr = document.createElement('tr');
        
        let classOptions = '<option value="">-- Brak --</option>';
        classesList.forEach(c => {
            const selected = s.class_id === c.id ? 'selected' : '';
            classOptions += `<option value="${c.id}" ${selected}>${c.name}</option>`;
        });

        let actionsHtml = `
            <div class="table-btn btn-save" title="Zapisz przypisanie klasy" onclick="saveClass('${s.id}', this)">
                <span class="material-symbols-rounded">save</span>
            </div>
        `;

        if (currentRole !== 'lecturer') {
            actionsHtml += `
                <div class="table-btn btn-pass" title="Ustaw nowe hasło" onclick="resetPass('${s.id}', '${s.username}')">
                    <span class="material-symbols-rounded">key</span>
                </div>
                <div class="table-btn btn-del" title="Usuń konto" onclick="deleteUser('${s.id}', this)">
                    <span class="material-symbols-rounded">delete</span>
                </div>
            `;
        }

        tr.innerHTML = `
            <td style="font-weight:bold;">${s.username}</td>
            <td>${s.email}</td>
            <td>
                <select class="class-select-table">${classOptions}</select>
            </td>
            <td class="action-cell">
                ${actionsHtml}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// User Actions
async function saveClass(userId, btnElement) {
    const row = btnElement.closest('tr');
    const select = row.querySelector('select');
    const newClassId = select.value ? parseInt(select.value) : null;

    const { error } = await _supabase.from('users').update({ class_id: newClassId }).eq('id', userId);
    
    if (error) alert("Błąd zapisu: " + error.message);
    else {
        const student = allStudents.find(s => s.id === userId);
        if(student) student.class_id = newClassId;
        alert("Zapisano zmianę klasy.");
    }
}

async function resetPass(userId, username) {
    const newPassword = prompt(`Podaj nowe hasło dla ucznia ${username}:`, "start123");
    
    if (!newPassword) return;
    if (newPassword.length < 6) { alert("Hasło musi mieć minimum 6 znaków."); return; }

    const { error } = await _supabase.rpc('admin_reset_password', {
        target_user_id: userId,
        new_password: newPassword
    });

    if (error) { console.error(error); alert("Błąd: " + error.message); } 
    else { alert(` Hasło zmienione! Przekaż uczniowi: ${newPassword}`); }
}

async function deleteUser(userId, btnElement) {
    if(!confirm("Czy na pewno chcesz trwale usunąć tego ucznia?")) return;
    const { error } = await _supabase.from('users').delete().eq('id', userId);
    if(error) alert("Błąd: " + error.message);
    else {
        allStudents = allStudents.filter(s => s.id !== userId);
        btnElement.closest('tr').remove();
    }
}
