const supabaseUrl = 'https://xzbonbdtfgrhihwmiamq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6Ym9uYmR0ZmdyaGlod21pYW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxNDYxMzAsImV4cCI6MjA3OTcyMjEzMH0.iqd1FO3kdgECw857Okf0CF_i570wcTk2VtJhJXSwlEg'; 
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentUserRole = null;
let currentUserSchoolId = null;
let currentUserClassId = null;
let schoolsCache = [];
let generatedMemberCode = null;

// --- NOWE ZMIENNE DLA RODZICA ---
let selectedChildrenIds = []; 
let currentChildId = null;

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    try { await _supabase.rpc('delete_old_events'); } catch (e) { console.log("Brak funkcji RPC, pomijam czyszczenie."); }

    const userId = session.user.id;
    const { data: profile } = await _supabase.from('users').select('username, role, school_id, class_id, schools(name), classes(name)').eq('id', userId).single();

    if (profile) {
        currentUserRole = profile.role;
        currentUserSchoolId = profile.school_id;
        currentUserClassId = profile.class_id;
        
        document.getElementById('profile-name-display').textContent = profile.username;
        // Mapa ról rozszerzona o Rodzica
        const roleMap = { 'student': 'UCZEŃ', 'teacher': 'NAUCZYCIEL', 'manager': 'MANAGER', 'admin': 'ADMIN', 'lecturer': 'WYKŁADOWCA', 'parent': 'RODZIC' };
        document.getElementById('profile-role-display').textContent = (roleMap[profile.role] || profile.role).toUpperCase();
        
        let schoolInfo = "";
        if (profile.schools && profile.schools.name) schoolInfo = profile.schools.name;
        if (profile.classes && profile.classes.name) schoolInfo += `<br><span style="color:var(--accent-color); font-weight:bold;">${profile.classes.name}</span>`;
        document.getElementById('profile-school-display').innerHTML = schoolInfo;
        document.getElementById('welcome-message').textContent = `Witaj, ${profile.username}!`;

        // --- KONFIGURACJA WIDOKU ---
        
        // 1. RODZIC
        if (currentUserRole === 'parent') {
            // Rodzic widzi sekcję studenta (ale dla dziecka)
            show('student-sidebar-content'); 
            show('widget-student-grades');
            show('widget-student-calendar');
            show('widget-student-behavior');
            
            // Ukrywamy widgety kadry
            ['widget-assign-course', 'widget-teacher-results', 'widget-teacher-grades', 'widget-calendar', 'widget-teacher-behavior'].forEach(hide);
            // Ukrywamy widget kursów (chyba że rodzic ma je widzieć)
            hide('widget-student-courses');

            // Kliknięcie w kalendarz otwiera modal
            document.getElementById('widget-student-calendar').onclick = () => openCalendarModal();

            // Pobieramy dzieci
            const { data: relations } = await _supabase.from('parent_children')
                .select('child_id, users:child_id(username)')
                .eq('parent_id', userId);

            if (relations && relations.length > 0) {
                const selectorDiv = document.getElementById('parent-child-selector-container');
                const selector = document.getElementById('parent-child-select');
                if(selectorDiv) selectorDiv.style.display = 'block';
                selector.innerHTML = '';

                relations.forEach((rel, index) => {
                    selector.add(new Option(rel.users.username, rel.child_id));
                    if(index === 0) currentChildId = rel.child_id;
                });

                // Załaduj dane pierwszego dziecka
                switchChildView(currentChildId);
            } else {
                alert("Brak przypisanych dzieci.");
            }

        } 
        // 2. KADRA (Admin, Nauczyciel, Manager, Wykładowca)
        else if (['admin', 'manager', 'teacher', 'lecturer'].includes(currentUserRole)) {
            show('widget-assign-course');
            show('widget-teacher-results');
            show('widget-teacher-grades');
            show('widget-calendar');
            show('widget-teacher-behavior');
            
            document.getElementById('widget-assign-course').onclick = () => openAssignCourseModal();
            document.getElementById('widget-calendar').onclick = () => openCalendarModal();

            if (currentUserRole === 'admin') {
                ['widget-admin-content', 'widget-create-course', 'widget-create-quiz', 'widget-add-user', 'widget-add-school', 'widget-manage-classes', 'widget-manage-students'].forEach(show);
                ['widget-student-courses', 'widget-student-grades', 'widget-student-calendar', 'widget-student-behavior'].forEach(hide);
                
                document.getElementById('widget-add-user').onclick = () => openCreateUserModal();
                document.getElementById('widget-add-school').onclick = () => openModal('addSchoolModal');
            }

            if (currentUserRole === 'manager') {
                show('widget-add-user');
                show('widget-manage-classes');
                show('widget-manage-students');
                document.getElementById('widget-add-user').onclick = () => openCreateUserModal();
            }

            if (currentUserRole === 'lecturer') {
                show('widget-manage-classes'); 
                show('widget-manage-students');
                hide('widget-add-user'); 
                hide('widget-add-school');
                show('widget-admin-content');
                show('widget-create-course');
                show('widget-create-quiz');
            }
        } 
        // 3. STUDENT
        else {
            show('student-sidebar-content'); 
            currentChildId = userId; // Uczeń patrzy na siebie
            switchChildView(userId);
            
            show('widget-student-courses');
            show('widget-student-grades');
            show('widget-student-calendar');
            document.getElementById('widget-student-calendar').onclick = () => openCalendarModal();
            show('widget-student-behavior');
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

        const { data: school } = await _supabase.from('schools').select('level').eq('id', sid).single();
        const { data: classes } = await _supabase.from('classes').select('id, name').eq('school_id', sid).order('name');
        
        cSelect.innerHTML = '<option value="" disabled selected>-- Wybierz Klasę --</option>';
        if (classes && classes.length > 0) { 
            classes.forEach(c => cSelect.add(new Option(c.name, c.id))); 
            cSelect.disabled = false; 
        } else { cSelect.innerHTML = '<option value="" disabled selected>Brak klas</option>'; }

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

// --- NOWE FUNKCJE DLA RODZICA ---

function switchChildView(childId) {
    currentChildId = childId;
    loadSidebarCalendar(childId);
    loadSidebarGrades(childId);
    loadSidebarRemarks(childId);
}

// Zmodyfikowane funkcje ładowania (przyjmują targetUserId)

async function loadSidebarCalendar(targetUserId) {
    const list = document.getElementById('sidebar-calendar-list');
    
    // Musimy pobrać klasę konkretnego użytkownika (dziecka)
    const { data: user } = await _supabase.from('users').select('class_id').eq('id', targetUserId).single();
    if(!user || !user.class_id) { list.innerHTML = '<p class="empty-sidebar">Brak klasy.</p>'; return; }

    const today = new Date().toISOString().split('T')[0];
    
    const { data } = await _supabase.from('calendar_events')
        .select('title, event_date, subject_name')
        .eq('class_id', user.class_id)
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(3);
    
    list.innerHTML = '';
    if(!data || data.length === 0) { list.innerHTML = '<p class="empty-sidebar">Brak wydarzeń.</p>'; return; }
    
    data.forEach(e => {
        const d = new Date(e.event_date);
        const dateStr = `${d.getDate()}.${d.getMonth()+1}`;
        const subj = e.subject_name ? `<b>${e.subject_name}:</b> ` : '';

        list.innerHTML += `
            <div class="sidebar-list-item">
                <div class="sidebar-list-date">${dateStr}</div>
                <div class="sidebar-list-content">${subj}${e.title}</div>
            </div>`;
    });
}

async function loadSidebarGrades(targetUserId) {
    const list = document.getElementById('sidebar-grades-list');
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    // targetUserId zamiast session.user.id
    const { data: grades } = await _supabase.from('grades')
        .select('grade, packages(title)')
        .eq('user_id', targetUserId)
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

async function loadSidebarRemarks(targetUserId) {
    const list = document.getElementById('sidebar-remarks-list');
    
    // targetUserId zamiast student_id z sesji
    const { data: remarks } = await _supabase.from('remarks')
        .select('category, subject_name, created_at, points')
        .eq('student_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(3);

    list.innerHTML = '';
    if (!remarks || remarks.length === 0) { 
        list.innerHTML = '<p class="empty-sidebar">Brak uwag.</p>'; 
        return; 
    }

    remarks.forEach(r => {
        const d = new Date(r.created_at);
        const dateStr = `${d.getDate()}.${d.getMonth() + 1}`;
        
        let pts = r.points || 0;
        let txt = pts > 0 ? "+" + pts : pts; 
        let color = '#757575'; 

        if (pts > 0) color = '#4CAF50'; 
        if (pts < 0) color = '#F44336'; 

        list.innerHTML += `
            <div class="sidebar-list-item">
                <div class="sidebar-grade-circle" style="color:${color}; border-color:${color}; font-size:14px; width:35px; height:35px;">
                    ${txt}
                </div>
                <div class="sidebar-list-content">
                    <span style="font-size:11px; color:#888;">${dateStr}</span><br>
                    ${r.subject_name}
                </div>
            </div>`;
    });
}

// --- FULL CALENDAR MODAL ---

async function openCalendarModal() {
    openModal('calendarModal');
    const list = document.getElementById('calendar-events-list');
    const tools = document.getElementById('calendar-teacher-tools');
    list.innerHTML = 'Ładowanie...';

    // Reset formularza
    if(document.getElementById('cal-subject-select')) {
        document.getElementById('cal-subject-select').innerHTML = '<option value="" disabled selected>-- Najpierw klasa --</option>';
        document.getElementById('cal-subject-select').disabled = true;
        document.getElementById('cal-subject-manual').style.display = 'none';
        document.getElementById('cal-subject-manual').value = '';
    }

    if(['admin', 'teacher', 'manager', 'lecturer'].includes(currentUserRole)) {
        tools.style.display = 'block';
        const sel = document.getElementById('cal-class');
        sel.innerHTML = '<option value="">Wybierz klasę...</option>';
        const { data: classes } = await _supabase.from('classes').select('id, name').eq('school_id', currentUserSchoolId).order('name');
        if(classes) classes.forEach(c => sel.add(new Option(c.name, c.id)));
        
        loadFullCalendar(true); 
    } else {
        tools.style.display = 'none';
        // Dla rodzica/studenta ładujemy kalendarz wybranego dziecka
        if(currentChildId) {
             const { data: user } = await _supabase.from('users').select('class_id').eq('id', currentChildId).single();
             if(user && user.class_id) {
                 loadFullCalendar(false, user.class_id); 
             } else {
                 list.innerHTML = '<p>To konto nie ma przypisanej klasy.</p>';
             }
        }
    }
}

async function loadFullCalendar(isTeacher, targetClassId) {
    const list = document.getElementById('calendar-events-list');
    let query = _supabase.from('calendar_events').select('*').order('event_date', { ascending: true });
    
    if(!isTeacher) { 
        if(!targetClassId) { list.innerHTML = '<p>Błąd: Brak klasy.</p>'; return; }
        const t = new Date().toISOString().split('T')[0]; 
        query = query.eq('class_id', targetClassId).gte('event_date', t); 
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

// --- LOGIKA KALENDARZA (PRZEDMIOTY) ---

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

    const { data: links } = await _supabase.from('package_classes').select('package_id').eq('class_id', classId);
    subjSelect.innerHTML = '<option value="" disabled selected>-- Wybierz Przedmiot --</option>';
    
    if (links && links.length > 0) {
        const pkgIds = links.map(l => l.package_id);
        const { data: packages } = await _supabase.from('packages').select('id, title').in('id', pkgIds);
        if (packages) packages.forEach(p => subjSelect.add(new Option(p.title, p.title)));
    }
    subjSelect.add(new Option("Inny (wpisz ręcznie)...", "custom"));
    subjSelect.disabled = false;
}

function toggleManualSubject(value) {
    const manualInput = document.getElementById('cal-subject-manual');
    if (value === 'custom') { manualInput.style.display = 'block'; manualInput.focus(); } else { manualInput.style.display = 'none'; }
}

async function addCalendarEvent() {
    const cid = document.getElementById('cal-class').value; 
    const d = document.getElementById('cal-date').value; 
    const t = document.getElementById('cal-type').value; 
    const tit = document.getElementById('cal-title').value; 
    const subjSelect = document.getElementById('cal-subject-select').value;
    const subjManual = document.getElementById('cal-subject-manual').value;
    
    let finalSubject = (subjSelect === 'custom') ? subjManual : subjSelect;

    if(!cid || !d || !tit || !finalSubject) return alert("Wypełnij wszystkie pola!"); 
    
    const {data:{session}} = await _supabase.auth.getSession(); 
    const {error} = await _supabase.from('calendar_events').insert({
        teacher_id: session.user.id, class_id: cid, title: tit, subject_name: finalSubject, event_date: d, type: t
    }); 
    
    if(error) alert(error.message); 
    else {
        document.getElementById('cal-title').value = ""; 
        document.getElementById('cal-subject-manual').value = "";
        loadFullCalendar(true); 
    } 
}

async function deleteCalendarEvent(id) { 
    if(!confirm("Usunąć?")) return; 
    await _supabase.from('calendar_events').delete().eq('id',id); 
    loadFullCalendar(true); 
}

// --- TWORZENIE UŻYTKOWNIKA I OBSŁUGA RODZICA ---

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
    
    // 1. Rejestracja
    const {data: newUser, error}=await tmp.auth.signUp({
        email:em, password:pw,
        options:{data:{username:un,role:ro,school_id:sid||null,class_id:cid,member_code:generatedMemberCode}}
    }); 
    
    if(error) { alert(error.message); btn.disabled=false; btn.textContent = "Utwórz konto"; return; } 

    // 2. Przypisanie dzieci (Rodzic)
    if (ro === 'parent' && selectedChildrenIds.length > 0 && newUser.user) {
        const parentId = newUser.user.id;
        const links = selectedChildrenIds.map(childId => ({ parent_id: parentId, child_id: childId }));
        const { error: linkError } = await _supabase.from('parent_children').insert(links);
        if(linkError) console.error("Błąd przypisywania dzieci:", linkError);
    }

    alert("Konto utworzone!"); 
    closeModal('createUserModal'); 
    document.getElementById('createUserForm').reset();
    selectedChildrenIds = []; updateSelectedChildrenUI();
    btn.disabled=false; btn.textContent = "Utwórz konto";
}

// --- WYSZUKIWANIE DZIECI ---

async function searchStudentForParent() {
    const term = document.getElementById('child-search-input').value;
    if(term.length < 3) return alert("Wpisz min. 3 znaki.");

    const list = document.getElementById('child-search-results');
    list.style.display = 'block';
    list.innerHTML = '<li style="padding:5px; color:#888;">Szukanie...</li>';

    const { data } = await _supabase.from('users').select('id, username, email').eq('role', 'student').ilike('username', `%${term}%`).limit(5);

    list.innerHTML = '';
    if(!data || data.length === 0) { list.innerHTML = '<li style="padding:5px;">Brak wyników</li>'; return; }

    data.forEach(s => {
        const li = document.createElement('li');
        li.style.padding = "8px"; li.style.borderBottom = "1px solid #eee"; li.style.cursor = "pointer";
        li.innerHTML = `<b>${s.username}</b> <br><span style="font-size:10px; color:#888;">${s.email}</span>`;
        li.onclick = () => addChildToSelection(s);
        li.onmouseover = () => li.style.background = "#f0f0f0"; li.onmouseout = () => li.style.background = "#fff";
        list.appendChild(li);
    });
}

function addChildToSelection(student) {
    if(selectedChildrenIds.includes(student.id)) return;
    selectedChildrenIds.push(student.id);
    const container = document.getElementById('selected-children-list');
    const badge = document.createElement('div');
    badge.style.cssText = "background:rgba(33,150,243,0.1); color:#2196F3; padding:5px 10px; border-radius:15px; font-size:12px; font-weight:bold; display:flex; gap:8px;";
    badge.innerHTML = `${student.username} <span style="cursor:pointer; color:red;" onclick="removeChildFromSelection('${student.id}', this)">&times;</span>`;
    container.appendChild(badge);
    document.getElementById('child-search-results').style.display = 'none';
    document.getElementById('child-search-input').value = '';
}

function removeChildFromSelection(id, elem) {
    selectedChildrenIds = selectedChildrenIds.filter(x => x !== id);
    elem.parentElement.remove();
}

function updateSelectedChildrenUI() { document.getElementById('selected-children-list').innerHTML = ''; }

// --- POMOCNICZE FORMULARZA ---

async function openCreateUserModal() { openModal('createUserModal'); await ensureSchoolsCache(); document.getElementById('new-user-level-filter').value = ""; const sSelect = document.getElementById('new-user-school'); sSelect.innerHTML = '<option value="" disabled selected>-- Wybierz typ najpierw --</option>'; sSelect.disabled = true; document.getElementById('class-select-container').style.display = 'none'; document.getElementById('new-email').value=""; }

function handleRoleChange() { 
    const role = document.getElementById('new-role').value; 
    const sc = document.getElementById('school-select-container'); 
    const cc = document.getElementById('class-select-container'); 
    const pt = document.getElementById('parent-tools-container'); 
    const em = document.getElementById('new-email'); 

    if(pt) pt.style.display = 'none';
    if(cc) cc.style.display = 'none';
    if(sc) sc.style.display = 'block';

    if (role === 'admin') { 
        sc.style.display = 'none'; em.removeAttribute('readonly'); em.value = ""; em.placeholder = "Email admina"; 
    } else { 
        em.setAttribute('readonly', true); em.placeholder = "Wybierz szkołę..."; 
        if (role === 'student') cc.style.display = 'block';
        if (role === 'parent') {
             if(pt) pt.style.display = 'block'; selectedChildrenIds = []; updateSelectedChildrenUI();
        }
        if(document.getElementById('new-user-school').value) generateEmail(); 
    } 
}

function filterNewUserSchools() { const lvl = document.getElementById('new-user-level-filter').value; const s = document.getElementById('new-user-school'); s.innerHTML = '<option value="" disabled selected>-- Wybierz --</option>'; schoolsCache.filter(x => x.level == lvl).forEach(x => s.add(new Option(x.name, x.id))); s.disabled = false; }
async function loadClassesForSchool(sid) { const c = document.getElementById('new-user-class'); c.innerHTML = '<option>...</option>'; c.disabled = true; const { data } = await _supabase.from('classes').select('id, name').eq('school_id', sid); c.innerHTML = '<option value="">-- Brak --</option>'; if(data) data.forEach(x => c.add(new Option(x.name, x.id))); c.disabled = false; }

async function generateEmail() { 
    const r = document.getElementById('new-role').value; 
    const sid = document.getElementById('new-user-school').value; 
    const em = document.getElementById('new-email'); 
    
    if(r==='admin') return; if(!sid) return; 

    em.value="..."; 
    const s=schoolsCache.find(x=>x.id==sid); const abbr=s?s.abbreviation:"SC"; 
    
    let query = _supabase.from('users').select('*',{count:'exact',head:true}).eq('school_id',sid);
    if(r==='student') query = query.eq('role', 'student');
    else if(r==='parent') query = query.eq('role', 'parent'); 
    else query = query.in('role', ['teacher', 'manager', 'lecturer', 'admin']);
    
    const {count} = await query; const n=(count||0)+1; generatedMemberCode=n; 
    let suffix = 'kadra';
    if(r === 'student') suffix = 'student';
    if(r === 'parent') suffix = 'rodzic';

    em.value = `${String(n).padStart(4,'0')}.${abbr}-${suffix}@muczelnia.pl`; 
}

async function addSchool(e){ e.preventDefault(); const {error}=await _supabase.from('schools').insert({name:document.getElementById('school-name').value, abbreviation:document.getElementById('school-abbr').value, level:document.getElementById('school-level').value, address:document.getElementById('school-address').value}); if(error)alert(error.message); else {alert("Dodano"); closeModal('addSchoolModal'); schoolsCache=[];} }

async function openAssignCourseModal(){ 
    openModal('assignCourseModal'); 
    const ss=document.getElementById('assign-school-select'); ss.innerHTML='<option disabled selected>Wybierz Szkołę</option>'; 
    let query = _supabase.from('schools').select('id,name');
    if(currentUserRole !== 'admin') query = query.eq('id', currentUserSchoolId);
    const {data:s}=await query; if(s) s.forEach(x=>ss.add(new Option(x.name,x.id))); 
    document.getElementById('assign-package-select').innerHTML='<option disabled selected>Najpierw Szkoła...</option>'; document.getElementById('assign-package-select').disabled = true;
}

async function assignCourseToClass(e){ e.preventDefault(); const p=document.getElementById('assign-package-select').value; const c=document.getElementById('assign-class-select').value; if(!c)return alert("Klasa!"); const {error}=await _supabase.from('package_classes').insert({package_id:p,class_id:c}); if(error)alert(error.message); else{alert("Przypisano"); closeModal('assignCourseModal');} }
