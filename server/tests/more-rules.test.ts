import "dotenv/config";
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {Employee,Task} from '../src/models.js';
const app=createApp();
const base={employeeId:'EMP-X',fullName:'Casey Green',email:'casey@example.com',phone:'+919876543210',department:'QA',role:'Tester',joiningDate:'2026-01-01',status:'Active',skills:[],leaveStart:null,leaveEnd:null};
const body=(assignedEmployee:string,extra:Record<string,unknown>={})=>({title:'Review, "files"',description:'=SUM(1,1)\nsecond line',assignedEmployee,department:'QA',priority:'Low',startDate:'2026-01-01',dueDate:'2026-10-24',...extra});
beforeAll(async()=>{await mongoose.connect(process.env.MONGODB_TEST_URI||'mongodb://127.0.0.1:27017/roots_employee_tasks_test?replicaSet=rs0');await Promise.all([Employee.init(),Task.init()]);});
beforeEach(async()=>{await Task.deleteMany({});await Employee.deleteMany({});});
afterAll(async()=>mongoose.disconnect());
it('enforces all status paths, rejects protected update fields and releases on delete',async()=>{
 const e=(await request(app).post('/api/employees').send(base)).body.data;
 const a=(await request(app).post('/api/tasks').send(body(e._id))).body.data;
 expect(a.status).toBe('Todo');
 expect((await request(app).put('/api/tasks/'+a._id).send({...body(e._id),status:'Completed'})).status).toBe(400);
 expect((await request(app).put('/api/tasks/'+a._id+'/status').send({status:'Todo'})).status).toBe(400);
 expect((await request(app).put('/api/tasks/'+a._id+'/status').send({status:'In Progress'})).status).toBe(200);
 expect((await request(app).put('/api/tasks/'+a._id+'/status').send({status:'Cancelled'})).status).toBe(200);
 expect((await request(app).put('/api/tasks/'+a._id+'/status').send({status:'Completed'})).status).toBe(400);
 const b=(await request(app).post('/api/tasks').send(body(e._id,{title:'Second'}))).body.data;
 expect((await request(app).put('/api/tasks/'+b._id+'/status').send({status:'Cancelled'})).status).toBe(200);
 expect((await request(app).delete('/api/tasks/'+b._id)).status).toBe(204);
 expect((await Employee.findById(e._id).select('+activeTaskCount'))?.activeTaskCount).toBe(0);
});
it('uses one overdue rule across list, detail, dashboard and CSV',async()=>{
 const e=(await request(app).post('/api/employees').send(base)).body.data;
 const today=new Date().toISOString().slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const dueToday=(await request(app).post('/api/tasks').send(body(e._id,{title:'Due today',dueDate:today}))).body.data;
 const late=(await request(app).post('/api/tasks').send(body(e._id,{title:'Late item',dueDate:yesterday}))).body.data;
 expect((await request(app).get('/api/tasks/'+dueToday._id)).body.data.isOverdue).toBe(false);
 expect((await request(app).get('/api/tasks/'+late._id)).body.data.isOverdue).toBe(true);
 expect((await request(app).get('/api/tasks')).body.data.filter((x:any)=>x.isOverdue)).toHaveLength(1);
 expect((await request(app).get('/api/dashboard')).body.data.tasks.overdue).toBe(1);
 expect((await request(app).get('/api/tasks/export')).text).toContain('"Yes"');
 expect((await request(app).put('/api/tasks/'+late._id+'/status').send({status:'Cancelled'})).status).toBe(200);
 expect((await request(app).get('/api/dashboard')).body.data.tasks.overdue).toBe(0);
});
it('keeps ordinary edits possible after status changes, but checks edited start date',async()=>{
 const e=(await request(app).post('/api/employees').send(base)).body.data;
 const t=(await request(app).post('/api/tasks').send(body(e._id))).body.data;
 expect((await request(app).put('/api/employees/'+e._id).send({...base,status:'Inactive'})).status).toBe(200);
 expect((await request(app).put('/api/tasks/'+t._id).send(body(e._id,{title:'Renamed'}))).status).toBe(200);
 expect((await request(app).put('/api/tasks/'+t._id).send(body(e._id,{startDate:'2026-01-02'}))).status).toBe(400);
});
it('escapes spreadsheet formulas and invalid queries',async()=>{
 const e=(await request(app).post('/api/employees').send(base)).body.data;
 await request(app).post('/api/tasks').send(body(e._id,{title:'=HYPERLINK("bad")'}));
 const csv=await request(app).get('/api/tasks/export');
 expect(csv.text).toContain("'=HYPERLINK");
 expect(csv.text).toContain('""bad""');
 expect((await request(app).get('/api/tasks?priority=Wrong')).status).toBe(400);
 expect((await request(app).get('/api/tasks?page=0')).status).toBe(400);
 expect((await request(app).get('/api/tasks?dueFrom=2026-10-30&dueTo=2026-10-01')).status).toBe(400);
});

it('does not double-release on concurrent cancellation and serializes deletion against assignment',async()=>{
 const e=(await request(app).post('/api/employees').send(base)).body.data;
 const t=(await request(app).post('/api/tasks').send(body(e._id))).body.data;
 const changes=await Promise.all([request(app).put('/api/tasks/'+t._id+'/status').send({status:'Cancelled'}),request(app).put('/api/tasks/'+t._id+'/status').send({status:'Cancelled'})]);
 expect(changes.map(x=>x.status).sort()).toEqual([200,400]);
 expect((await Employee.findById(e._id).select('+activeTaskCount'))?.activeTaskCount).toBe(0);
 const target=(await request(app).post('/api/employees').send({...base,employeeId:'EMP-Y',email:'y@example.com'})).body.data;
 const [deleted,assigned]=await Promise.all([request(app).delete('/api/employees/'+target._id),request(app).post('/api/tasks').send(body(target._id,{title:'Racing task'}))]);
 expect([[204,404],[400,201]].some(([a,b])=>deleted.status===a&&assigned.status===b)).toBe(true);
 const record=await Employee.findById(target._id).select('+activeTaskCount');
 expect(!(record?.deletedAt&&record.activeTaskCount>0)).toBe(true);
});

it('checks duplicate IDs and emails, malformed IDs, leave periods and equal dates',async()=>{
 const e=(await request(app).post('/api/employees').send(base)).body.data;
 expect((await request(app).post('/api/employees').send({...base,email:'new@example.com'})).status).toBe(409);
 const duplicates=await Promise.all([
  request(app).post('/api/employees').send({...base,employeeId:'EMP-D1',email:' duplicate@example.com '}),
  request(app).post('/api/employees').send({...base,employeeId:'EMP-D2',email:'DUPLICATE@example.com'})
 ]);
 expect(duplicates.map(x=>x.status).sort()).toEqual([201,409]);
 const missing=new mongoose.Types.ObjectId().toString();
 for(const endpoint of ['/api/employees','/api/tasks']){
  expect((await request(app).get(endpoint+'/bad-id')).status).toBe(400);
  expect((await request(app).get(endpoint+'/'+missing)).status).toBe(404);
 }
 for(const dates of [{leaveStart:null,leaveEnd:'2026-11-10'},{leaveStart:'2026-11-11',leaveEnd:'2026-11-10'},{leaveStart:'2026-02-30',leaveEnd:'2026-11-10'}]){
  expect((await request(app).post('/api/employees').send({...base,employeeId:'EMP-L',email:'leave@example.com',status:'On Leave',...dates})).status).toBe(400);
 }
 const leave=(await request(app).post('/api/employees').send({...base,employeeId:'EMP-L',email:'leave@example.com',status:'On Leave',leaveStart:'2026-11-01',leaveEnd:'2026-11-10'})).body.data;
 const changed=await request(app).put('/api/employees/'+leave._id).send({...base,employeeId:'EMP-L',email:'leave@example.com',status:'Active',leaveStart:'2026-11-01',leaveEnd:'2026-11-10'});
 expect(changed.status).toBe(200);expect(changed.body.data.leaveStart).toBeNull();expect(changed.body.data.leaveEnd).toBeNull();
 expect((await request(app).post('/api/tasks').send(body(e._id,{startDate:'2026-10-24',dueDate:'2026-10-24'}))).status).toBe(201);
 expect((await request(app).post('/api/tasks').send({...body(e._id),completedAt:'2026-10-24'})).status).toBe(400);
});
it('owns completion time and releases exactly once on concurrent deletes',async()=>{
 const e=(await request(app).post('/api/employees').send(base)).body.data;
 const task=(await request(app).post('/api/tasks').send(body(e._id))).body.data;
 expect(task.completedAt).toBeNull();
 expect((await request(app).put('/api/tasks/'+task._id+'/status').send({status:'In Progress'})).status).toBe(200);
 const done=await request(app).put('/api/tasks/'+task._id+'/status').send({status:'Completed'});
 expect(done.status).toBe(200);expect(Number.isNaN(Date.parse(done.body.data.completedAt))).toBe(false);
 expect((await request(app).put('/api/tasks/'+task._id).send({...body(e._id),completedAt:null})).status).toBe(400);
 const active=(await request(app).post('/api/tasks').send(body(e._id,{title:'Delete race'}))).body.data;
 const deleted=await Promise.all([request(app).delete('/api/tasks/'+active._id),request(app).delete('/api/tasks/'+active._id)]);
 expect(deleted.map(x=>x.status).sort()).toEqual([204,404]);
 expect((await Employee.findById(e._id).select('+activeTaskCount'))?.activeTaskCount).toBe(0);
});
it('aggregates every dashboard status and includes zero-workload employees',async()=>{
 const active=(await request(app).post('/api/employees').send(base)).body.data;
 await request(app).post('/api/employees').send({...base,employeeId:'EMP-I',email:'i@example.com',status:'Inactive'});
 const leave=(await request(app).post('/api/employees').send({...base,employeeId:'EMP-L',email:'l@example.com',status:'On Leave',leaveStart:'2026-11-01',leaveEnd:'2026-11-10'})).body.data;
 const zero=(await request(app).post('/api/employees').send({...base,employeeId:'EMP-Z',email:'z@example.com',fullName:'Zero Tasks'})).body.data;
 const todo=(await request(app).post('/api/tasks').send(body(active._id,{title:'Todo task'}))).body.data;
 const progress=(await request(app).post('/api/tasks').send(body(active._id,{title:'Progress task'}))).body.data;
 const completed=(await request(app).post('/api/tasks').send(body(leave._id,{title:'Complete task'}))).body.data;
 const cancelled=(await request(app).post('/api/tasks').send(body(leave._id,{title:'Cancel task'}))).body.data;
 expect(todo.status).toBe('Todo');
 await request(app).put('/api/tasks/'+progress._id+'/status').send({status:'In Progress'});
 await request(app).put('/api/tasks/'+completed._id+'/status').send({status:'In Progress'});
 await request(app).put('/api/tasks/'+completed._id+'/status').send({status:'Completed'});
 await request(app).put('/api/tasks/'+cancelled._id+'/status').send({status:'Cancelled'});
 expect((await request(app).delete('/api/employees/'+leave._id)).status).toBe(204);
 const dash=(await request(app).get('/api/dashboard')).body.data;
 expect(dash.employees).toEqual({total:3,active:2,inactive:1,onLeave:0});
 expect(dash.tasks).toMatchObject({total:4,todo:1,inProgress:1,completed:1,cancelled:1});
 expect(dash.workload.find((x:any)=>x.employeeId===active._id).activeTasks).toBe(2);
 expect(dash.workload.find((x:any)=>x.employeeId===zero._id).activeTasks).toBe(0);
 expect(dash.workload.find((x:any)=>x.employeeId===leave._id)).toBeUndefined();
});

it('keeps overdue identical across list, detail, dashboard and CSV at a fixed UTC clock',async()=>{
 const {vi}=await import('vitest');
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
 try{
  const e=(await request(app).post('/api/employees').send(base)).body.data;
  const yesterday=(await request(app).post('/api/tasks').send(body(e._id,{title:'Due yesterday',dueDate:'2026-10-23'}))).body.data;
  const today=(await request(app).post('/api/tasks').send(body(e._id,{title:'Due today',dueDate:'2026-10-24'}))).body.data;
  const list=(await request(app).get('/api/tasks')).body.data;
  expect(list.find((x:any)=>x._id===yesterday._id).isOverdue).toBe(true);
  expect(list.find((x:any)=>x._id===today._id).isOverdue).toBe(false);
  expect((await request(app).get('/api/tasks/'+yesterday._id)).body.data.isOverdue).toBe(true);
  expect((await request(app).get('/api/tasks/'+today._id)).body.data.isOverdue).toBe(false);
  expect((await request(app).get('/api/dashboard')).body.data.tasks.overdue).toBe(1);
  const csv=(await request(app).get('/api/tasks/export')).text;
  expect((csv.match(/"Yes"/g)||[]).length).toBe(1);
  expect((csv.match(/"No"/g)||[]).length).toBe(1);
 }finally{vi.useRealTimers()}
});
