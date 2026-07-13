// Migrates SQLite dump data into the PostgreSQL task database
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL })

// ── Data extracted from SQLite dump ─────────────────────────────────

const templates = [
  ['9c645aff-2ac1-492a-9f21-6ba84517ee23','mon','하루 준비: 스트레칭, 할 일 체크',0,1782640005750],
  ['5c1db21e-9d46-4c00-9b2b-8a2f1d415f0c','tue','하루 준비: 스트레칭, 할 일 체크',0,1782640006041],
  ['59612d87-73f9-4d04-ae58-3a04778f98fd','wed','하루 준비: 스트레칭, 할 일 체크',0,1782640006429],
  ['2929d9d6-ab20-4cad-b18d-42020ee890bb','thu','하루 준비: 스트레칭, 할 일 체크',0,1782640006717],
  ['4ddf81ff-d188-40ee-a429-0bc09e5db04d','fri','하루 준비: 스트레칭, 할 일 체크',0,1782640007004],
  ['102da037-7955-4a0c-b47b-4205a291eb38','weekend','하루 준비: 스트레칭, 할 일 체크',0,1782640007292],
  ['90431406-c198-45d3-b6ff-4fe5e2083e0f','mon','맨몸 운동: 상체, 코어, 하체',1,1782640028123],
  ['2d73e51c-b68d-41de-8742-5e6d13e04c19','wed','맨몸 운동: 상체, 코어, 하체',1,1782640028587],
  ['b6084d02-f674-4bad-a9b7-a3e3d1a58652','fri','맨몸 운동: 상체, 코어, 하체',2,1782640028922],
  ['6368b01b-1975-48f9-b7fd-08fb4ab636b9','weekend','맨몸 운동: 러닝',2,1782640036901],
  ['52161ba8-d81e-4d5a-8075-0d92fee16f30','fri','회사 업무: AWS CSE',3,1782640049728],
  ['6e2eadb1-ee91-4cec-a05a-66f7a81a01e2','thu','회사 업무: AWS CSE',1,1782640050017],
  ['09a9e6e0-634e-4a6b-8952-120110438879','wed','회사 업무: AWS CSE',2,1782640050307],
  ['0467b61f-405a-4f42-b562-e9e454335ec1','tue','회사 업무: AWS CSE',1,1782640050593],
  ['0031a81b-9166-4b95-9c1e-3dc8be8a28ba','mon','회사 업무: AWS CSE',2,1782640050937],
  ['86d134b7-1702-4392-8fbc-3f1adeffa990','thu','학습: 문서 & 도서 읽기',3,1782640091215],
  ['4cc1447a-19eb-48df-87ca-b9db77baeccb','tue','학습: 문서 & 도서 읽기',3,1782640091510],
  ['6c96f235-fd98-47f3-ae2e-6bcff9f64879','weekend','학습: 문서 & 도서 읽기',5,1782640091833],
  ['c646571d-b62e-4503-8f1f-5feac2d26908','thu','프로젝트: 홈서버, 오픈소스',2,1782640126117],
  ['53acbc25-237a-450e-801c-e0d67532c282','tue','프로젝트: 홈서버, 오픈소스',2,1782640126430],
  ['c94c5007-02fa-4032-85ca-e75aad10714a','weekend','프로젝트: 홈서버, 오픈소스',4,1782640126714],
  ['12845c90-5793-452b-8a30-1043c8162142','weekend','네트워킹: 약속 & 커피챗',1,1782640133630],
  ['2cc46dbd-21e0-4189-8ab2-de298854e530','weekend','집안일: 청소',3,1782640137580],
  ['77b93c20-6d0b-4fe6-ba86-1c4b75649de4','weekend','하루 마무리: 회고',6,1782640144086],
  ['ddf6652c-a08d-4ef4-924a-fd9e68aae3d9','fri','하루 마무리: 회고',4,1782640144370],
  ['d728dd15-1b07-4693-a04d-dcb2df3b44c4','thu','하루 마무리: 회고',4,1782640144657],
  ['0f78b30b-53cc-4996-9118-f1c839c32bf5','mon','하루 마무리: 회고',3,1782640144945],
  ['bc8f56f6-5ded-4278-8d15-7f3e4946d160','tue','하루 마무리: 회고',4,1782640145304],
  ['bca34b43-2700-4928-8ac1-a13902637d9b','wed','하루 마무리: 회고',3,1782640145591],
]

// [id, slot_date, text, completed(0/1), created_at]
const daily_additions = [
  ['e44a5061-1b51-4d75-b5f5-3a05172cabf9','2026-06-29','소마: 1on1 w/ 재호님',1,1782692370416],
  ['cc497d89-98f6-464e-a283-e86534304d02','2026-06-30','민주님과의 저녁식사~!',1,1782800777818],
  ['b1e655ba-5184-46ef-afa3-364918f3340b','2026-07-01','여행 짐 챙기기',0,1782829250326],
  ['189346bb-071f-40a7-a2c5-ef167ded7c2a','2026-07-01','민주 생각><',1,1782829256143],
  ['e4e631f9-c13d-4f67-907c-16108882ebef','2026-07-08','배그 약속 in 크래프톤 w/ 시형님',0,1783312441139],
]

const template_completions = [
  ['12845c90-5793-452b-8a30-1043c8162142','2026-06-28'],
  ['6368b01b-1975-48f9-b7fd-08fb4ab636b9','2026-06-28'],
  ['2cc46dbd-21e0-4189-8ab2-de298854e530','2026-06-28'],
  ['c94c5007-02fa-4032-85ca-e75aad10714a','2026-06-28'],
  ['102da037-7955-4a0c-b47b-4205a291eb38','2026-06-28'],
  ['77b93c20-6d0b-4fe6-ba86-1c4b75649de4','2026-06-28'],
  ['9c645aff-2ac1-492a-9f21-6ba84517ee23','2026-06-29'],
  ['90431406-c198-45d3-b6ff-4fe5e2083e0f','2026-06-29'],
  ['0031a81b-9166-4b95-9c1e-3dc8be8a28ba','2026-06-29'],
  ['0f78b30b-53cc-4996-9118-f1c839c32bf5','2026-06-29'],
  ['5c1db21e-9d46-4c00-9b2b-8a2f1d415f0c','2026-06-30'],
  ['53acbc25-237a-450e-801c-e0d67532c282','2026-06-30'],
  ['0467b61f-405a-4f42-b562-e9e454335ec1','2026-06-30'],
  ['4cc1447a-19eb-48df-87ca-b9db77baeccb','2026-06-30'],
  ['bc8f56f6-5ded-4278-8d15-7f3e4946d160','2026-06-30'],
  ['59612d87-73f9-4d04-ae58-3a04778f98fd','2026-07-01'],
  ['09a9e6e0-634e-4a6b-8952-120110438879','2026-07-01'],
  ['2d73e51c-b68d-41de-8742-5e6d13e04c19','2026-07-01'],
  ['9c645aff-2ac1-492a-9f21-6ba84517ee23','2026-07-06'],
  ['0031a81b-9166-4b95-9c1e-3dc8be8a28ba','2026-07-06'],
]

// SQLite old column order: id, title, start_date, end_date, time, created_at, recurrence
// Note: some rows have recurrence as 3rd-to-last (older schema stored created_at as TEXT with .0 suffix)
const events = [
  // id, title, start_date, end_date, time, recurrence, created_at
  ['950cd1f2-802f-484d-999b-8a3b5e14e36c','Tokyo Trip','2026-07-02','2026-07-05',null,null,1782806126189],
  ['91eb5394-f245-4b5e-a549-13e7da8423a2','Ado STADIUM LIVE 2026','2026-07-04','2026-07-04','18:00',null,1782807340244],
  ['1e3bca08-9d97-4ada-ae07-1fd9f6197d3e',"Sister's Birthday",'2026-06-28','2026-06-28',null,'yearly',1782808236418],
  ['879520a9-2307-4c3a-93ff-3957aa2db5ec',"Mom's Birthday",'2026-04-08','2026-04-08',null,'yearly',1782808256128],
  ['30eb1ba6-0b46-4e7f-97f0-87aa4c83f567','My Birthday','2026-03-14','2026-03-14',null,'yearly',1782808305644],
  ['90e785bb-a532-4376-a541-65fa57e3e7b8',"Father's Birthday",'2026-02-05','2026-02-05',null,'yearly',1782808317765],
  ['9e74cd35-f6b4-4d0d-873c-3034f77982f0',"Minju's Birthday",'2026-09-07','2026-09-07',null,'yearly',1782808340360],
  ['4baff252-2909-4838-a498-a24eced753c7',"natori ONE-MAN LIVE TOUR 'Koshin (March)",'2026-07-18','2026-07-18','18:00',null,1782809213168],
  ['3e84b7cc-6f03-460f-8d31-44310662c76b','Vaundy ASIA ARENA TOUR 2026 "HORO" IN SEOUL','2026-09-19','2026-09-20',null,null,1782809235385],
  ['8628cd36-de7e-4eaa-a36f-460556ae60d5',"Minju's Birthday",'2026-09-07','2026-09-07',null,null,1782829179069],
]

const settings = [
  ['rotateHour','6'],
  ['rotateMinute','0'],
  ['keepBonus','false'],
]

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const [id, slot, text, position, created_at] of templates) {
      await client.query(
        'INSERT INTO templates (id,slot,text,position,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [id, slot, text, position, created_at]
      )
    }
    console.log(`templates: ${templates.length}`)

    for (const [id, slot_date, text, completed, created_at] of daily_additions) {
      await client.query(
        'INSERT INTO daily_additions (id,slot_date,text,completed,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [id, slot_date, text, completed === 1, created_at]
      )
    }
    console.log(`daily_additions: ${daily_additions.length}`)

    for (const [template_id, slot_date] of template_completions) {
      await client.query(
        'INSERT INTO template_completions (template_id,slot_date) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [template_id, slot_date]
      )
    }
    console.log(`template_completions: ${template_completions.length}`)

    for (const [id, title, start_date, end_date, time, recurrence, created_at] of events) {
      await client.query(
        'INSERT INTO events (id,title,start_date,end_date,time,recurrence,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [id, title, start_date, end_date, time, recurrence, created_at]
      )
    }
    console.log(`events: ${events.length}`)

    for (const [key, value] of settings) {
      await client.query(
        'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, value]
      )
    }
    console.log(`settings: ${settings.length}`)

    await client.query('COMMIT')
    console.log('Migration complete.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
