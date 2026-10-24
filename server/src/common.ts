import mongoose from 'mongoose';
import { z } from 'zod';

export const departments = ['Development','Design','QA','HR','Sales'] as const;
export const employeeStatuses = ['Active','Inactive','On Leave'] as const;
export const priorities = ['Low','Medium','High','Critical'] as const;
export const taskStatuses = ['Todo','In Progress','Completed','Cancelled'] as const;
export const activeStatuses = ['Todo','In Progress'];
export const nextStatuses: Record<string,string[]> = {'Todo':['In Progress','Cancelled'],'In Progress':['Completed','Cancelled'],'Completed':[],'Cancelled':[]};
export const today = () => new Date().toISOString().slice(0,10);
export const isOverdue = (task:{dueDate:string,status:string}, day=today()) => task.dueDate < day && activeStatuses.includes(task.status);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Use YYYY-MM-DD').refine(v => {
  const d = new Date(v+'T00:00:00.000Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === v;
},'Invalid calendar date');
export class ApiError extends Error {
  constructor(public status:number, public code:string, message:string, public fields:Record<string,string>={}) {super(message);}
}
export function objectId(value:string) {
  if (!mongoose.isValidObjectId(value) || String(new mongoose.Types.ObjectId(value)) !== value.toLowerCase()) throw new ApiError(400,'INVALID_ID','Invalid record ID.');
  return new mongoose.Types.ObjectId(value);
}
export const employeeInput = z.strictObject({
  employeeId:z.string().trim().min(1).max(40),
  fullName:z.string().trim().min(2).max(120),
  email:z.string().trim().toLowerCase().pipe(z.email()),
  phone:z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/,'Enter a valid phone number'),
  department:z.enum(departments), role:z.string().trim().min(2).max(100),
  joiningDate:dateSchema, status:z.enum(employeeStatuses),
  skills:z.array(z.string().trim().min(1).max(60)).max(30),
  leaveStart:dateSchema.optional().nullable(), leaveEnd:dateSchema.optional().nullable()
}).superRefine((v,ctx)=>{
  if(v.status==='On Leave' && (!v.leaveStart || !v.leaveEnd)) ctx.addIssue({code:'custom',message:'Both leave dates are required.',path:['leaveStart']});
  if(v.leaveStart && v.leaveEnd && v.leaveStart>v.leaveEnd) ctx.addIssue({code:'custom',message:'Leave end must be on or after leave start.',path:['leaveEnd']});
});
export const taskInput = z.strictObject({
  title:z.string().trim().min(2).max(160), description:z.string().trim().min(1).max(5000),
  assignedEmployee:z.string(), department:z.enum(departments),priority:z.enum(priorities),
  startDate:dateSchema,dueDate:dateSchema
}).superRefine((v,ctx)=>{if(v.dueDate<v.startDate)ctx.addIssue({code:'custom',message:'Due date must be on or after start date.',path:['dueDate']});});
export const statusInput = z.strictObject({status:z.enum(taskStatuses)});
export function parse<T>(schema:z.ZodType<T>, value:unknown):T {
  const result=schema.safeParse(value);
  if(result.success)return result.data;
  const fields:Record<string,string>={};
  for(const issue of result.error.issues) fields[issue.path.join('.')||'_form']=issue.message;
  throw new ApiError(400,'VALIDATION_ERROR','Please correct the highlighted fields.',fields);
}
export function escapeRegex(s:string){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
