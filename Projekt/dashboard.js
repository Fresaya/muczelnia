const supabaseUrl = 'https://xzbonbdtfgrhihwmiamq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6Ym9uYmR0ZmdyaGlod21pYW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxNDYxMzAsImV4cCI6MjA3OTcyMjEzMH0.iqd1FO3kdgECw857Okf0CF_i570wcTk2VtJhJXSwlEg'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentUserRole = null;
let currentUserSchoolId = null;
let currentUserClassId = null;
let schoolsCache = [];
let generatedMemberCode = null;

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    // --- NOWE: Czyszczenie starych eventów (SQL RPC) ---
    // Wymaga funkcji w bazie: create function delete_old_events()...
    try { await _supabase.rpc('delete_old_events'); } catch (e) { console.log("Brak funkcji RPC, pomijam czyszczenie."); }

    const userId = session.user.id;
    const { data: profile } = await _supabase.from('users').select('username, role, school_id, class_id, schools(name), classes(name)').eq('id', userId).single();

    if (profile) {
        currentUserRole = profile.role;
        currentUserSchoolId = profile.school_id;
        currentUserClassId = profile.class_id;
        
        document.getElementById('profile-name-display').textContent = profile.username;
        const roleMap = { 'student': 'UCZEŃ', 'teacher': 'NAUCZYCIEL', 'manager': 'MANAGER', 'admin': 'ADMIN', 'lecturer': 'WYKŁADOWCA' };
        document.getElementById('profile-role-display').textContent = (roleMap[profile.role] || profile.role).toUpperCase();
        
        let schoolInfo = "";
        if (profile.schools && profile.schools.name) schoolInfo = profile.schools.name;
        if (profile.classes && profile.classes.name) schoolInfo += `<br><span style="color:var(--accent-color); font-weight:bold;">${profile.classes.name}</span>`;
        document.getElementById('profile-school-display').innerHTML = schoolInfo;
        document.getElementById('welcome-message').textContent = `Witaj, ${profile.username}!`;

        // --- WIDOCZNOŚĆ WIDGETÓW ---
        if (['admin', 'manager', 'teacher', 'lecturer'].includes(currentUserRole)) {
            show('widget-assign-course');
            show('widget-teacher-results');
            show('widget-teacher-grades');
            show('widget-calendar'); // To jest kalendarz dla nauczyciela (edycja)
            show('widget-teacher-behavior')
            
            document.getElementById('widget-assign-course').onclick = () => openAssignCourseModal();
            document.getElementById('widget-calendar').onclick = () => openCalendarModal();
        } else {
            // --- SEKCJA UCZNIA ---
            show('student-sidebar-content'); 
            loadSidebarCalendar(); 
            loadSidebarGrades();
            
            // Pokaż widgety ucznia
            show('widget-student-courses');
            show('widget-student-grades');
            show('widget-student-calendar'); // <--- DODANY KAFELEK KALENDARZA DLA UCZNIA
            document.getElementById('widget-student-calendar').onclick = () => openCalendarModal();
        }

        if (currentUserRole === 'admin') {
            ['widget-admin-content', 'widget-create-course', 'widget-create-quiz', 'widget-add-user', 'widget-add-school', 'widget-manage-classes', 'widget-manage-students'].forEach(show);
            ['widget-student-courses', 'widget-student-grades'].forEach(hide);
            
            document.getElementById('widget-add-user').onclick = () => openCreateUserModal();
            document.getElementById('widget-add-school').onclick = () => openModal('addSchoolModal');
        }

        if (currentUserRole === 'manager') {
            show('widget-add-user');
            show('widget-manage-classes');
            show('widget-manage-students');
            document.getElementById('widget-add-user').onclick = () => openCreateUserModal();
        }

        // WYKŁADOWCA
        if (currentUserRole === 'lecturer') {
            show('widget-manage-classes'); 
            show('widget-manage-students');
            hide('widget-add-user'); 
            hide('widget-add-school');
            show('widget-admin-content'); // Baza treści
            show('widget-create-course'); // Tworzenie kursu
            show('widget-create-quiz');   // Tworzenie quizu
        }
    }

    // Listeners
    document.getElementById('avatarTrigger').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('profileDropdown').classList.toggle('show'); });
    window.addEventListener('click', () => document.getElementById('profileDropdown').classList.remove('show'));
    document.getElementById('logoutBtn').addEventListener('click', async () => { await _supabase.auth.signOut(); window.location.href = 'login.html'; });

    document.getElementById('createUserForm').addEventListener('submit', createNewUser);
    document.getElementById('addSchoolForm').addEventListener('submit', addSchool);
    document.getElementById('assignCourseForm').addEventListener('submit', assignCourseToClass);
    
    document.getElementById('new-role').addEventListener('change', handleRoleChange);
    document.getElementById('new-user-level-filter').addEventListener('change', filterNewUserSchools);
    document.getElementById('new-user-school').addEventListener('change', async function() { await loadClassesForSchool(this.value); generateEmail(); });
    document.getElementById('new-user-class').addEventListener('change', generateEmail);

    // ASSIGN COURSE LOGIC
    document.getElementById('assign-school-select').addEventListener('change', async function() {
        const sid = parseInt(this.value); 
        const cSelect = document.getElementById('assign-class-select');
        const pSelect = document.getElementById('assign-package-select');
        
        cSelect.disabled = true; cSelect.innerHTML = '<option>Ładowanie...</option>';
        pSelect.disabled = true; pSelect.innerHTML = '<option>Ładowanie...</option>';

        // 1. Get School Level
        const { data: school } = await _supabase.from('schools').select('level').eq('id', sid).single();
        
        // 2. Load Classes
        const { data: classes } = await _supabase.from('classes').select('id, name').eq('school_id', sid).order('name');
        cSelect.innerHTML = '<option value="" disabled selected>-- Wybierz Klasę --</option>';
        if (classes && classes.length > 0) { 
            classes.forEach(c => cSelect.add(new Option(c.name, c.id))); 
            cSelect.disabled = false; 
        } else { cSelect.innerHTML = '<option value="" disabled selected>Brak klas</option>'; }

        // 3. Load Packages Filtered by Level
        if(school) {
            const { data: pkgs } = await _supabase.from('packages').select('id, title').eq('level', school.level);
            pSelect.innerHTML = '<option value="" disabled selected>-- Wybierz Pakiet --</option>';
            if(pkgs && pkgs.length > 0) {
                pkgs.forEach(p => pSelect.add(new Option(p.title, p.id)));
                pSelect.disabled = false;
            } else { pSelect.innerHTML = '<option disabled>Brak pakietów dla tego poziomu</option>'; }
        }
    });
});

// --- COMMON FUNCTIONS ---
function show(id) { const el=document.getElementById(id); if(el)el.style.display='flex'; }
function hide(id) { const el=document.getElementById(id); if(el)el.style.display='none'; }
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

async function ensureSchoolsCache() {
    if (schoolsCache.length === 0) {
        const { data } = await _supabase.from('schools').select('id, name, level, abbreviation');
        schoolsCache = data || [];
    }
}

// --- SIDEBAR DATA (STUDENT) ---
async function loadSidebarCalendar() {
    const list = document.getElementById('sidebar-calendar-list');
    if(!currentUserClassId) { list.innerHTML = '<p class="empty-sidebar">Brak klasy.</p>'; return; }
    const today = new Date().toISOString().split('T')[0];
    
    // Zmieniono: pobieranie subject_name
    const { data } = await _supabase.from('calendar_events')
        .select('title, event_date, subject_name')
        .eq('class_id', currentUserClassId)
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(3);
    
    list.innerHTML = '';
    if(!data || data.length === 0) { list.innerHTML = '<p class="empty-sidebar">Brak wydarzeń.</p>'; return; }
    
    data.forEach(e => {
        const d = new Date(e.event_date);
        const dateStr = `${d.getDate()}.${d.getMonth()+1}`;
        const subj = e.subject_name ? `<b>${e.subject_name}:</b> ` : ''; // Formatowanie przedmiotu

        list.innerHTML += `
            <div class="sidebar-list-item">
                <div class="sidebar-list-date">${dateStr}</div>
                <div class="sidebar-list-content">${subj}${e.title}</div>
            </div>`;
    });
}

async function loadSidebarGrades() {
    const list = document.getElementById('sidebar-grades-list');
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: { session } } = await _supabase.auth.getSession();
    const { data: grades } = await _supabase.from('grades')
        .select('grade, packages(title)')
        .eq('user_id', session.user.id)
        .gte('created_at', weekAgo)
        .order('created_at', { ascending: false })
        .limit(5);

    list.innerHTML = '';
    if(!grades || grades.length === 0) { list.innerHTML = '<p class="empty-sidebar">Brak nowych ocen.</p>'; return; }

    grades.forEach(g => {
        const pkgTitle = g.packages ? g.packages.title : 'Inne';
        list.innerHTML += `
            <div class="sidebar-list-item">
                <div class="sidebar-grade-circle">${g.grade}</div>
                <div class="sidebar-list-content">${pkgTitle}</div>
            </div>`;
    });
}

// --- FULL CALENDAR MODAL ---
async function openCalendarModal() {
    openModal('calendarModal');
    const list = document.getElementById('calendar-events-list');
    const tools = document.getElementById('calendar-teacher-tools');
    list.innerHTML = 'Ładowanie...';

    // Resetowanie pól formularza
    if(document.getElementById('cal-subject-select')) {
        document.getElementById('cal-subject-select').innerHTML = '<option value="" disabled selected>-- Najpierw klasa --</option>';
        document.getElementById('cal-subject-select').disabled = true;
        document.getElementById('cal-subject-manual').style.display = 'none';
        document.getElementById('cal-subject-manual').value = '';
    }

    if(['admin', 'teacher', 'manager', 'lecturer'].includes(currentUserRole)) {
        tools.style.display = 'block';
        const sel = document.getElementById('cal-class');
        // Resetowanie selecta klas przy każdym otwarciu
        sel.innerHTML = '<option value="">Wybierz klasę...</option>';
        
        const { data: classes } = await _supabase.from('classes').select('id, name').eq('school_id', currentUserSchoolId).order('name');
        if(classes) classes.forEach(c => sel.add(new Option(c.name, c.id)));
        
        loadFullCalendar(true); 
    } else {
        tools.style.display = 'none';
        loadFullCalendar(false);
    }
}

async function loadFullCalendar(isTeacher) {
    const list = document.getElementById('calendar-events-list');
    let query = _supabase.from('calendar_events').select('*').order('event_date', { ascending: true });
    
    // Jeśli to uczeń, filtrujemy po jego klasie
    if(!isTeacher) { 
        const t = new Date().toISOString().split('T')[0]; 
        query = query.eq('class_id', currentUserClassId).gte('event_date', t); 
    }
    
    const { data: ev } = await query;
    list.innerHTML = '';
    if(!ev || ev.length === 0){ list.innerHTML='<p style="text-align:center; color:#888;">Brak.</p>'; return; }
    
    const mm=["ST","LUT","MAR","KWI","MAJ","CZE","LIP","SIE","WRZ","PAŹ","LIS","GRU"];
    const typeClass = { 'test': 'bg-test', 'homework': 'bg-homework', 'info': 'bg-info' };
    const typeName = { 'test': 'Sprawdzian', 'homework': 'Zadanie', 'info': 'Info' };

    ev.forEach(e => { 
        const d = new Date(e.event_date); 
        const div = document.createElement('div'); div.className = 'event-item'; 
        
        // Wyświetlanie przedmiotu
        const subjectDisplay = e.subject_name ? `<span style="display:block; font-size:11px; color:var(--accent-color); font-weight:bold; text-transform:uppercase; margin-bottom:2px;">${e.subject_name}</span>` : '';

        div.innerHTML = `
            <div class="event-date-box">
                <span class="event-day">${d.getDate()}</span>
                <span class="event-month">${mm[d.getMonth()]}</span>
            </div>
            <div class="event-details">
                ${subjectDisplay}
                <div class="event-title">${e.title}<span class="event-badge ${typeClass[e.type]}">${typeName[e.type]}</span></div>
                <div class="event-meta">${isTeacher ? `ID Klasy: ${e.class_id}` : ''}</div>
            </div>
            ${isTeacher ? `<div class="delete-mini-btn" onclick="deleteCalendarEvent(${e.id})">&times;</div>` : ''}
        `; 
        list.appendChild(div); 
    }); 
}

// --- NOWE FUNKCJE KALENDARZA (OBSŁUGA PRZEDMIOTÓW) ---

async function loadSubjectsForCalendar(classId) {
    const subjSelect = document.getElementById('cal-subject-select');
    const manualInput = document.getElementById('cal-subject-manual');
    
    subjSelect.innerHTML = '<option>Ładowanie...</option>';
    subjSelect.disabled = true;
    manualInput.style.display = 'none';
    manualInput.value = '';

    if (!classId) {
        subjSelect.innerHTML = '<option value="" disabled selected>-- Najpierw klasa --</option>';
        return;
    }

    // Pobierz pakiety przypisane do tej klasy
    const { data: links } = await _supabase.from('package_classes').select('package_id').eq('class_id', classId);
    
    subjSelect.innerHTML = '<option value="" disabled selected>-- Wybierz Przedmiot --</option>';
    
    if (links && links.length > 0) {
        const pkgIds = links.map(l => l.package_id);
        const { data: packages } = await _supabase.from('packages').select('id, title').in('id', pkgIds);
        
        if (packages) {
            packages.forEach(p => {
                subjSelect.add(new Option(p.title, p.title)); // Value to nazwa przedmiotu
            });
        }
    }

    subjSelect.add(new Option("Inny (wpisz ręcznie)...", "custom"));
    subjSelect.disabled = false;
}

function toggleManualSubject(value) {
    const manualInput = document.getElementById('cal-subject-manual');
    if (value === 'custom') {
        manualInput.style.display = 'block';
        manualInput.focus();
    } else {
        manualInput.style.display = 'none';
    }
}

async function addCalendarEvent() {
    const cid = document.getElementById('cal-class').value; 
    const d = document.getElementById('cal-date').value; 
    const t = document.getElementById('cal-type').value; 
    const tit = document.getElementById('cal-title').value; 

    // Pobieranie przedmiotu
    const subjSelect = document.getElementById('cal-subject-select').value;
    const subjManual = document.getElementById('cal-subject-manual').value;
    
    let finalSubject = null;
    if (subjSelect === 'custom') {
        finalSubject = subjManual;
    } else {
        finalSubject = subjSelect;
    }

    if(!cid || !d || !tit || !finalSubject) return alert("Wypełnij wszystkie pola (klasę, datę, przedmiot i opis)!"); 
    
    const {data:{session}} = await _supabase.auth.getSession(); 
    
    const {error} = await _supabase.from('calendar_events').insert({
        teacher_id: session.user.id,
        class_id: cid,
        title: tit,
        subject_name: finalSubject,
        event_date: d,
        type: t
    }); 
    
    if(error) alert(error.message); 
    else {
        // Reset formularza
        document.getElementById('cal-title').value = ""; 
        document.getElementById('cal-subject-manual').value = "";
        // Odśwież widok
        loadFullCalendar(true); 
        loadSidebarCalendar();
    } 
}

async function deleteCalendarEvent(id) { 
    if(!confirm("Usunąć?")) return; 
    await _supabase.from('calendar_events').delete().eq('id',id); 
    loadFullCalendar(true); 
}

// --- INNE FUNKCJE ---

async function createNewUser(e) { 
    e.preventDefault(); 
    const btn=document.getElementById('createBtn'); 
    btn.disabled=true; btn.textContent = "Tworzenie...";
    
    const em=document.getElementById('new-email').value; 
    const pw=document.getElementById('new-password').value; 
    const un=document.getElementById('new-username').value; 
    const ro=document.getElementById('new-role').value; 
    const sid=document.getElementById('new-user-school').value; 
    const cid=document.getElementById('new-user-class').value||null; 
    
    const tmp=supabase.createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false}}); 
    const {error}=await tmp.auth.signUp({
        email:em, password:pw,
        options:{data:{username:un,role:ro,school_id:sid||null,class_id:cid,member_code:generatedMemberCode}}
    }); 
    
    if(error) alert(error.message); 
    else { alert("Konto utworzone!"); closeModal('createUserModal'); document.getElementById('createUserForm').reset(); } 
    btn.disabled=false; btn.textContent = "Utwórz konto";
}

async function openCreateUserModal() { openModal('createUserModal'); await ensureSchoolsCache(); document.getElementById('new-user-level-filter').value = ""; const sSelect = document.getElementById('new-user-school'); sSelect.innerHTML = '<option value="" disabled selected>-- Wybierz typ najpierw --</option>'; sSelect.disabled = true; document.getElementById('class-select-container').style.display = 'none'; document.getElementById('new-email').value=""; }
function handleRoleChange() { const role = document.getElementById('new-role').value; const sc = document.getElementById('school-select-container'); const cc = document.getElementById('class-select-container'); const em = document.getElementById('new-email'); if (role === 'admin') { sc.style.display = 'none'; em.removeAttribute('readonly'); em.value = ""; em.placeholder = "Email admina"; } else { sc.style.display = 'block'; em.setAttribute('readonly', true); em.placeholder = "Wybierz szkołę..."; cc.style.display = (role === 'student') ? 'block' : 'none'; if(document.getElementById('new-user-school').value) generateEmail(); } }
function filterNewUserSchools() { const lvl = document.getElementById('new-user-level-filter').value; const s = document.getElementById('new-user-school'); s.innerHTML = '<option value="" disabled selected>-- Wybierz --</option>'; schoolsCache.filter(x => x.level == lvl).forEach(x => s.add(new Option(x.name, x.id))); s.disabled = false; }
async function loadClassesForSchool(sid) { const c = document.getElementById('new-user-class'); c.innerHTML = '<option>...</option>'; c.disabled = true; const { data } = await _supabase.from('classes').select('id, name').eq('school_id', sid); c.innerHTML = '<option value="">-- Brak --</option>'; if(data) data.forEach(x => c.add(new Option(x.name, x.id))); c.disabled = false; }

async function generateEmail() { 
    const r = document.getElementById('new-role').value; 
    const sid = document.getElementById('new-user-school').value; 
    const em = document.getElementById('new-email'); 
    if(r==='admin'||!sid)return; 
    em.value="..."; 
    
    const s=schoolsCache.find(x=>x.id==sid); 
    const abbr=s?s.abbreviation:"SC"; 
    
    let query = _supabase.from('users').select('*',{count:'exact',head:true}).eq('school_id',sid);
    if(r==='student') query = query.eq('role', 'student');
    else query = query.in('role', ['teacher', 'manager', 'lecturer', 'admin']);
    
    const {count} = await query;
    const n=(count||0)+1; 
    generatedMemberCode=n; 
    em.value = `${String(n).padStart(4,'0')}.${abbr}-${r==='student'?'student':'kadra'}@muczelnia.pl`; 
}

async function addSchool(e){ e.preventDefault(); const {error}=await _supabase.from('schools').insert({name:document.getElementById('school-name').value, abbreviation:document.getElementById('school-abbr').value, level:document.getElementById('school-level').value, address:document.getElementById('school-address').value}); if(error)alert(error.message); else {alert("Dodano"); closeModal('addSchoolModal'); schoolsCache=[];} }

async function openAssignCourseModal(){ 
    openModal('assignCourseModal'); 
    const ss=document.getElementById('assign-school-select'); 
    ss.innerHTML='<option disabled selected>Wybierz Szkołę</option>'; 
    let query = _supabase.from('schools').select('id,name');
    if(currentUserRole !== 'admin') query = query.eq('id', currentUserSchoolId);
    
    const {data:s}=await query;
    if(s) s.forEach(x=>ss.add(new Option(x.name,x.id))); 
    
    document.getElementById('assign-package-select').innerHTML='<option disabled selected>Najpierw Szkoła...</option>';
    document.getElementById('assign-package-select').disabled = true;
}

async function assignCourseToClass(e){ e.preventDefault(); const p=document.getElementById('assign-package-select').value; const c=document.getElementById('assign-class-select').value; if(!c)return alert("Klasa!"); const {error}=await _supabase.from('package_classes').insert({package_id:p,class_id:c}); if(error)alert(error.message); else{alert("Przypisano"); closeModal('assignCourseModal');} }
