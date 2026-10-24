import {PipelineStage} from 'mongoose';
import {ApiError,dateSchema,departments,employeeStatuses,escapeRegex,nextStatuses,priorities,taskStatuses,today} from './common.js';
import {Employee,Task} from './models.js';

type Q=Record<string,unknown>;
function value(q:Q,key:string){const v=q[key];if(v===undefined)return '';if(typeof v!=='string')throw new ApiError(400,'INVALID_QUERY','Invalid '+key+'.');return v.trim();}
function choice(v:string,allowed:readonly string[],key:string){if(v&&!allowed.includes(v))throw new ApiError(400,'INVALID_QUERY','Invalid '+key+'.');return v;}
function integer(v:string,key:string,defaultValue:number,max:number){if(!v)return defaultValue;if(!/^[1-9]\d*$/.test(v)||Number(v)>max)throw new ApiError(400,'INVALID_QUERY','Invalid '+key+'.');return Number(v);}
export function listQuery(q:Q,kind:'task'|'employee',exporting=false){
  const allowed=kind==='task'?['search','department','priority','status','dueFrom','dueTo','sortBy','sortOrder','page','limit']:['search','department','status','sortBy','sortOrder','page','limit'];
  for(const k of Object.keys(q))if(!allowed.includes(k))throw new ApiError(400,'INVALID_QUERY','Unknown query parameter: '+k);
  const search=value(q,'search').slice(0,120);
  const department=choice(value(q,'department'),departments,'department');
  const status=choice(value(q,'status'),kind==='task'?taskStatuses:employeeStatuses,'status');
  const priority=kind==='task'?choice(value(q,'priority'),priorities,'priority'):'';
  const dueFrom=kind==='task'?value(q,'dueFrom'):'';
  const dueTo=kind==='task'?value(q,'dueTo'):'';
  for(const [k,v] of [['dueFrom',dueFrom],['dueTo',dueTo]])if(v&&!dateSchema.safeParse(v).success)throw new ApiError(400,'INVALID_QUERY','Invalid '+k+'.');
  if(dueFrom&&dueTo&&dueFrom>dueTo)throw new ApiError(400,'INVALID_QUERY','Due date range is reversed.');
  const sortBy=choice(value(q,'sortBy'),kind==='task'?['createdAt','dueDate','priority','title']:['createdAt','fullName','joiningDate'],'sortBy')||'createdAt';
  const sortOrder=choice(value(q,'sortOrder'),['asc','desc'],'sortOrder')||'desc';
  const page=exporting?1:integer(value(q,'page'),'page',1,1000000);
  const limit=exporting?0:integer(value(q,'limit'),'limit',10,100);
  return {search,department,status,priority,dueFrom,dueTo,sortBy,sortOrder,page,limit};
}
export async function listEmployees(q:Q){
  const p=listQuery(q,'employee');const filter:any={deletedAt:null};
  if(p.department)filter.department=p.department;if(p.status)filter.status=p.status;
  if(p.search)filter.fullName={$regex:escapeRegex(p.search),$options:'i'};
  const direction=p.sortOrder==='asc'?1:-1;
  const [data,total]=await Promise.all([
    Employee.find(filter).select('-activeTaskCount -version').sort({[p.sortBy]:direction,_id:direction}).skip((p.page-1)*p.limit).limit(p.limit).lean(),
    Employee.countDocuments(filter)]);
  return {data:data.map(e=>({...e,isDeleted:false})),pagination:{page:p.page,limit:p.limit,total,totalPages:Math.ceil(total/p.limit)}};
}
function taskPipeline(p:ReturnType<typeof listQuery>,day:string){
  const match:any={};if(p.department)match.department=p.department;if(p.priority)match.priority=p.priority;if(p.status)match.status=p.status;
  if(p.dueFrom||p.dueTo){match.dueDate={};if(p.dueFrom)match.dueDate.$gte=p.dueFrom;if(p.dueTo)match.dueDate.$lte=p.dueTo;}
  const stages:any[]=[{$match:match},{$lookup:{from:Employee.collection.name,localField:'assignedEmployee',foreignField:'_id',as:'employee'}},{$unwind:'$employee'}];
  if(p.search){const re=escapeRegex(p.search);stages.push({$match:{$or:[{title:{$regex:re,$options:'i'}},{'employee.fullName':{$regex:re,$options:'i'}}]}});}
  stages.push({$addFields:{priorityRank:{$switch:{branches:priorities.map((v,i)=>({case:{$eq:['$priority',v]},then:i+1})),default:0}},isOverdue:{$and:[{$lt:['$dueDate',day]},{$in:['$status',['Todo','In Progress']]}]}}});
  const direction=p.sortOrder==='asc'?1:-1;const key=p.sortBy==='priority'?'priorityRank':p.sortBy;
  stages.push({$sort:{[key]:direction,_id:direction}});
  stages.push({$project:{priorityRank:0,'employee.activeTaskCount':0,'employee.version':0}});
  return stages as PipelineStage[];
}
function serializeTask(t:any){const e=t.employee;delete t.employee;return {...t,assignedEmployee:{_id:e._id,employeeId:e.employeeId,fullName:e.fullName,email:e.email,department:e.department,isDeleted:!!e.deletedAt},allowedNextStatuses:nextStatuses[t.status]};}
export async function listTasks(q:Q){
  const p=listQuery(q,'task'),day=today(),base=taskPipeline(p,day);
  const [[count],data]=await Promise.all([
    Task.aggregate([...base,{$count:'total'}]),Task.aggregate([...base,{$skip:(p.page-1)*p.limit},{$limit:p.limit}])]);
  const total=count?.total||0;
  return {data:data.map(serializeTask),pagination:{page:p.page,limit:p.limit,total,totalPages:Math.ceil(total/p.limit)}};
}
function csvCell(v:unknown){let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export async function exportTasks(q:Q){
  const p=listQuery(q,'task',true),day=today();
  const rows=await Task.aggregate(taskPipeline(p,day)).cursor({batchSize:200});
  const head=['Task ID','Title','Description','Employee ID','Employee Name','Department','Priority','Status','Start Date','Due Date','Created Date','Completed Date','Overdue'];
  const lines=[head.map(csvCell).join(',')];
  for await(const raw of rows){const t=serializeTask(raw);lines.push([t.taskId,t.title,t.description,t.assignedEmployee.employeeId,t.assignedEmployee.fullName,t.department,t.priority,t.status,t.startDate,t.dueDate,t.createdAt?.toISOString(),t.completedAt?.toISOString(),t.isOverdue?'Yes':'No'].map(csvCell).join(','));}
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
export async function dashboard(){
  const day=today();
  const [employeeGroups,taskGroups,overdue,employees,workloads]=await Promise.all([
    Employee.aggregate([{$match:{deletedAt:null}},{$group:{_id:'$status',count:{$sum:1}}}]),
    Task.aggregate([{$group:{_id:'$status',count:{$sum:1}}}]),
    Task.countDocuments({dueDate:{$lt:day},status:{$in:['Todo','In Progress']}}),
    Employee.find({deletedAt:null}).select('employeeId fullName').sort({fullName:1,_id:1}).lean(),
    Task.aggregate([{$match:{status:{$in:['Todo','In Progress']}}},{$group:{_id:'$assignedEmployee',count:{$sum:1}}}])
  ]);
  const ec=Object.fromEntries(employeeGroups.map(x=>[x._id,x.count])),tc=Object.fromEntries(taskGroups.map(x=>[x._id,x.count]));
  const wm=new Map(workloads.map(x=>[String(x._id),x.count]));
  return {employees:{total:employees.length,active:ec.Active||0,inactive:ec.Inactive||0,onLeave:ec['On Leave']||0},tasks:{total:Object.values(tc).reduce((a:number,b:any)=>a+Number(b),0),todo:tc.Todo||0,inProgress:tc['In Progress']||0,completed:tc.Completed||0,cancelled:tc.Cancelled||0,overdue},workload:employees.map(e=>({employeeId:e._id,employeeCode:e.employeeId,fullName:e.fullName,activeTasks:wm.get(String(e._id))||0}))};
}
