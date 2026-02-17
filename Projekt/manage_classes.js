// Config
const supabaseUrl = 'https://xzbonbdtfgrhihwmiamq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6Ym9uYmR0ZmdyaGlod21pYW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxNDYxMzAsImV4cCI6MjA3OTcyMjEzMH0.iqd1FO3kdgECw857Okf0CF_i570wcTk2VtJhJXSwlEg'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// State
let currentRole = null;
let availablePackages = []; 
let allClassesCache = []; 

// Init & Auth
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: user } = await _supabase.from('users').select('role, school_id').eq('id', session.user.id).single();
    
    if (!['admin', 'manager', 'lecturer', 'teacher'].includes(user.role)) {
        alert("Brak uprawnień."); window.location.href = 'dashboard.html'; return;
    }
    currentRole = user.role;

    await loadSchools(user);
    
    document.getElementById('school-select').addEventListener('change', async function() {
        await loadPackagesForSchoolLevel(this.value); 
        loadClasses(this.value); 
    });

    document.getElementById('class-search').addEventListener('input', filterClasses);
});

// Data Loading
async function loadSchools(user) {
    const sSelect = document.getElementById('school-select');
    sSelect.innerHTML = '<option value="" disabled selected>-- Wybierz Szkołę --</option>';
    
    let query = _supabase.from('schools').select('id, name, level').order('name');
    if (currentRole !== 'admin') {
        query = query.eq('id', user.school_id);
    }

    const { data: schools } = await query;
    
    if (schools) {
        schools.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            opt.dataset.level = s.level; 
            sSelect.appendChild(opt);
        });

        if (schools.length === 1) {
            const singleSchool = schools[0];
            sSelect.value = singleSchool.id;
            sSelect.disabled = true; 
            
            await loadPackagesForSchoolLevel(singleSchool.id);
            loadClasses(singleSchool.id);
        }
    }
}

async function loadPackagesForSchoolLevel(schoolId) {
    const select = document.getElementById('school-select');
    const selectedOption = select.options[select.selectedIndex];
    const level = selectedOption ? selectedOption.dataset.level : null;

    if (!level) return;

    const { data: pkgs } = await _supabase.from('packages')
        .select('id, title')
        .eq('level', level)
        .order('title');
    
    availablePackages = pkgs || [];
}

async function loadClasses(schoolId) {
    const grid = document.getElementById('classes-grid');
    grid.innerHTML = '<p style="grid-column:1/-1; text-align:center;">Ładowanie klas...</p>';

    const { data: classes, error } = await _supabase
        .from('classes')
        .select(`
            id, name,
            package_classes (
                id,
                packages ( id, title )
            )
        `)
        .eq('school_id', schoolId)
        .order('name');

    if (error) { console.error(error); grid.innerHTML = '<p>Błąd ładowania.</p>'; return; }
    
    allClassesCache = classes || [];
    renderClassesGrid(allClassesCache);
}

// Rendering & Filtering
function filterClasses() {
    const term = document.getElementById('class-search').value.toLowerCase();
    const filtered = allClassesCache.filter(c => c.name.toLowerCase().includes(term));
    renderClassesGrid(filtered);
}

function renderClassesGrid(classesToRender) {
    const grid = document.getElementById('classes-grid');
    grid.innerHTML = '';

    if (classesToRender.length === 0) {
        grid.innerHTML = '<p style="grid-column:1/-1; text-align:center; color:#888;">Brak klas spełniających kryteria.</p>';
        return;
    }

    classesToRender.forEach(c => {
        const card = document.createElement('div');
        card.className = 'class-card';

        // Header
        const header = document.createElement('div');
        header.className = 'card-header';
        
        const nameInput = document.createElement('input');
        nameInput.className = 'class-name-input';
        nameInput.value = c.name;
        nameInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') { await updateClassName(c.id, nameInput.value); nameInput.blur(); }
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn-icon-small btn-save-name';
        saveBtn.innerHTML = '<span class="material-symbols-rounded">check</span>';
        saveBtn.title = "Zapisz nazwę";
        saveBtn.onclick = () => updateClassName(c.id, nameInput.value);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-icon-small btn-delete-class';
        delBtn.innerHTML = '<span class="material-symbols-rounded">delete</span>';
        delBtn.title = "Usuń klasę";
        delBtn.onclick = () => deleteClass(c.id);

        header.append(nameInput, saveBtn, delBtn);

        // Packages
        const pkgArea = document.createElement('div');
        pkgArea.className = 'packages-area';
        
        if (c.package_classes && c.package_classes.length > 0) {
            c.package_classes.forEach(pc => {
                if (pc.packages) {
                    const chip = document.createElement('div');
                    chip.className = 'pkg-chip';
                    chip.innerHTML = `
                        <span class="material-symbols-rounded" style="font-size:16px;">inventory_2</span>
                        ${pc.packages.title} 
                        <span class="pkg-remove" onclick="unlinkPackage(${pc.id}, this)">
                            <span class="material-symbols-rounded">close</span>
                        </span>
                    `;
                    pkgArea.appendChild(chip);
                }
            });
        } else {
            pkgArea.innerHTML = '<span style="font-size:11px; color:#aaa; margin:auto 0;">Brak pakietów</span>';
        }

        // Footer
        const footer = document.createElement('div');
        footer.className = 'card-footer';

        const pkgSelect = document.createElement('select');
        pkgSelect.className = 'add-pkg-select';
        pkgSelect.innerHTML = '<option value="">+ Przypisz pakiet...</option>';
        
        const assignedIds = c.package_classes.map(pc => pc.packages ? pc.packages.id : -1);
        
        availablePackages.forEach(p => {
            if (!assignedIds.includes(p.id)) {
                pkgSelect.add(new Option(p.title, p.id));
            }
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'btn-add-pkg';
        addBtn.innerHTML = '<span class="material-symbols-rounded">add</span>';
        addBtn.onclick = async () => {
            if (!pkgSelect.value) return;
            await linkPackage(c.id, pkgSelect.value);
        };

        footer.append(pkgSelect, addBtn);

        card.append(header, pkgArea, footer);
        grid.appendChild(card);
    });
}

// CRUD Actions
async function createNewClass() {
    const schoolId = document.getElementById('school-select').value;
    const name = document.getElementById('new-class-name').value;
    if (!schoolId) return alert("Wybierz szkołę!");
    if (!name) return alert("Podaj nazwę klasy!");

    const { error } = await _supabase.from('classes').insert({ school_id: schoolId, name: name });
    if (error) alert(error.message);
    else {
        document.getElementById('new-class-name').value = '';
        loadClasses(schoolId);
    }
}

async function updateClassName(classId, newName) {
    const { error } = await _supabase.from('classes').update({ name: newName }).eq('id', classId);
    if (error) alert("Błąd: " + error.message);
}

async function deleteClass(classId) {
    if(!confirm("Usunąć klasę? Upewnij się, że nie ma w niej uczniów!")) return;
    const { error } = await _supabase.from('classes').delete().eq('id', classId);
    if (error) alert("Błąd: " + error.message);
    else loadClasses(document.getElementById('school-select').value);
}

async function linkPackage(classId, packageId) {
    const { error } = await _supabase.from('package_classes').insert({ class_id: classId, package_id: packageId });
    if (error) alert(error.message);
    else loadClasses(document.getElementById('school-select').value);
}

async function unlinkPackage(linkId, element) {
    if(!confirm("Odpiąć pakiet?")) return;
    const { error } = await _supabase.from('package_classes').delete().eq('id', linkId);
    if (error) alert(error.message);
    else element.parentElement.remove();
}
