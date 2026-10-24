import mongoose, {ClientSession} from 'mongoose';
import {randomUUID} from 'node:crypto';
import {ApiError,activeStatuses,employeeInput,isOverdue,nextStatuses,objectId,parse,statusInput,taskInput,today} from './common.js';
import {Employee,Task} from './models.js';

function viewEmployee(e:any){const x=e.toObject?e.toObject():e;return {_id:x._id,employeeId:x.employeeId,fullName:x.fullName,email:x.email,phone:x.phone,department:x.department,role:x.role,joiningDate:x.joiningDate,status:x.status,skills:x.skills,leaveStart:x.leaveStart,leaveEnd:x.leaveEnd,createdAt:x.createdAt,updatedAt:x.updatedAt,isDeleted:!!x.deletedAt};}
function viewTask(t:any,e:any,day=today()){const x=t.toObject?t.toObject():t;return {...x,assignedEmployee:e?{_id:e._id,employeeId:e.employeeId,fullName:e.fullName,email:e.email,department:e.department,isDeleted:!!e.deletedAt}:null,isOverdue:isOverdue(x,day),allowedNextStatuses:nextStatuses[x.status]};}
async function employeeForTask(id:string,date:string,session:ClientSession){
  const e=await Employee.findOne({_id:objectId(id),deletedAt:null}).select('+activeTaskCount +version').session(session);
  if(!e)throw new ApiError(404,'EMPLOYEE_NOT_FOUND','Employee not found.');
  if(e.status==='Inactive')throw new ApiError(400,'EMPLOYEE_INACTIVE','Inactive employees cannot receive tasks.');
  if(e.status==='On Leave' && e.leaveStart && e.leaveEnd && date>=e.leaveStart && date<=e.leaveEnd)throw new ApiError(400,'EMPLOYEE_ON_LEAVE','Task start date falls within this employee’s leave.');
  return e;
}
async function reserve(id:any,session:ClientSession){
  const e=await Employee.findOneAndUpdate({_id:id,deletedAt:null,activeTaskCount:{$lt:3}},{$inc:{activeTaskCount:1,version:1}},{session,new:true});
  if(!e)throw new ApiError(400,'EMPLOYEE_CAPACITY_EXCEEDED','This employee already has 3 active tasks. Choose another employee.');
}
async function release(id:any,session:ClientSession){
  const e=await Employee.findOneAndUpdate({_id:id,activeTaskCount:{$gt:0}},{$inc:{activeTaskCount:-1,version:1}},{session});
  if(!e)throw new Error('Active task counter invariant failed.');
}
export async function createEmployee(body:unknown){const data=parse(employeeInput,body);const e=await Employee.create({...data,leaveStart:data.status==='On Leave'?data.leaveStart:null,leaveEnd:data.status==='On Leave'?data.leaveEnd:null});return viewEmployee(e);}
export async function getEmployee(id:string){const e=await Employee.findOne({_id:objectId(id),deletedAt:null});if(!e)throw new ApiError(404,'EMPLOYEE_NOT_FOUND','Employee not found.');return viewEmployee(e);}
export async function updateEmployee(id:string,body:unknown){
  const data=parse(employeeInput,body);const _id=objectId(id);let result:any;
  await mongoose.connection.transaction(async session=>{
    const e=await Employee.findOne({_id,deletedAt:null}).select('+version').session(session);
    if(!e)throw new ApiError(404,'EMPLOYEE_NOT_FOUND','Employee not found.');
    Object.assign(e,data,{leaveStart:data.status==='On Leave'?data.leaveStart:null,leaveEnd:data.status==='On Leave'?data.leaveEnd:null});
    e.version+=1;await e.save({session});result=viewEmployee(e);
  });return result;
}
export async function deleteEmployee(id:string){
  const _id=objectId(id);
  await mongoose.connection.transaction(async session=>{
    const e=await Employee.findOne({_id,deletedAt:null}).select('+activeTaskCount').session(session);
    if(!e)throw new ApiError(404,'EMPLOYEE_NOT_FOUND','Employee not found.');
    if(e.activeTaskCount>0)throw new ApiError(400,'EMPLOYEE_HAS_ACTIVE_TASKS','Complete, cancel or reassign active tasks before deleting this employee.');
    const updated=await Employee.updateOne({_id,deletedAt:null,activeTaskCount:0},{$set:{deletedAt:new Date()},$inc:{version:1}},{session});
    if(!updated.modifiedCount)throw new ApiError(400,'EMPLOYEE_HAS_ACTIVE_TASKS','Employee has active tasks.');
  });
}
export async function createTask(body:unknown){
  const data=parse(taskInput,body);let result:any;
  await mongoose.connection.transaction(async session=>{
    const e=await employeeForTask(data.assignedEmployee,data.startDate,session);
    await reserve(e._id,session);
    const [t]=await Task.create([{...data,assignedEmployee:e._id,taskId:'TSK-'+randomUUID().slice(0,8).toUpperCase(),status:'Todo',completedAt:null}],{session});
    result=viewTask(t,e);
  });return result;
}
async function existingTask(id:string,session:ClientSession){const t=await Task.findById(objectId(id)).session(session);if(!t)throw new ApiError(404,'TASK_NOT_FOUND','Task not found.');return t;}
export async function getTask(id:string){const t=await Task.findById(objectId(id));if(!t)throw new ApiError(404,'TASK_NOT_FOUND','Task not found.');const e=await Employee.findById(t.assignedEmployee);return viewTask(t,e);}
export async function updateTask(id:string,body:unknown){
  const data=parse(taskInput,body);let result:any;
  await mongoose.connection.transaction(async session=>{
    const t=await existingTask(id,session);
    if(!activeStatuses.includes(t.status))throw new ApiError(400,'TASK_TERMINAL','Completed and cancelled tasks cannot be edited.');
    const oldId=t.assignedEmployee;
    const assignmentChanged=data.assignedEmployee!==String(oldId);
    const dateChanged=data.startDate!==t.startDate;
    const e=assignmentChanged||dateChanged?await employeeForTask(data.assignedEmployee,data.startDate,session):await Employee.findById(oldId).session(session);
    if(!e)throw new ApiError(404,'EMPLOYEE_NOT_FOUND','Employee not found.');
    if(assignmentChanged){await reserve(e._id,session);await release(oldId,session);}
    else if(dateChanged){await Employee.updateOne({_id:e._id},{$inc:{version:1}},{session});}
    Object.assign(t,data,{assignedEmployee:e._id});await t.save({session});result=viewTask(t,e);
  });return result;
}
export async function changeStatus(id:string,body:unknown){
  const {status}=parse(statusInput,body);let result:any;
  await mongoose.connection.transaction(async session=>{
    const t=await existingTask(id,session);
    if(!nextStatuses[t.status]?.includes(status))throw new ApiError(400,'INVALID_STATUS_TRANSITION','This status change is not allowed.');
    if(!activeStatuses.includes(status))await release(t.assignedEmployee,session);
    t.status=status;t.completedAt=status==='Completed'?new Date():null;await t.save({session});
    const e=await Employee.findById(t.assignedEmployee).session(session);result=viewTask(t,e);
  });return result;
}
export async function deleteTask(id:string){
  await mongoose.connection.transaction(async session=>{
    const t=await existingTask(id,session);
    if(activeStatuses.includes(t.status))await release(t.assignedEmployee,session);
    await Task.deleteOne({_id:t._id},{session});
  });
}
