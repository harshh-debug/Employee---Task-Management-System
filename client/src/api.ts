export const API_BASE=(import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/,'');
export type Employee={_id:string;employeeId:string;fullName:string;email:string;phone:string;department:string;role:string;joiningDate:string;status:string;skills:string[];leaveStart:string|null;leaveEnd:string|null;isDeleted?:boolean};
export type EmployeeSummary=Pick<Employee,'_id'|'employeeId'|'fullName'|'email'|'department'|'isDeleted'>;
export type Task={_id:string;taskId:string;title:string;description:string;assignedEmployee:EmployeeSummary;department:string;priority:string;status:string;startDate:string;dueDate:string;createdAt:string;completedAt:string|null;isOverdue:boolean;allowedNextStatuses:string[]};
export type List<T>={data:T[];pagination:{page:number;limit:number;total:number;totalPages:number}};
export type Dashboard={employees:{total:number;active:number;inactive:number;onLeave:number};tasks:{total:number;todo:number;inProgress:number;completed:number;cancelled:number;overdue:number};workload:{employeeId:string;employeeCode:string;fullName:string;activeTasks:number}[]};
export class ApiFailure extends Error{constructor(message:string,public fields:Record<string,string>={}){super(message)}}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch(API_BASE+path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 if(response.status===204)return undefined as T;
 const payload=await response.json().catch(()=>null);
 if(!response.ok)throw new ApiFailure(payload?.error?.message||'Request failed. Please try again.',payload?.error?.fields||{});
 return payload as T;
}
export const json=(method:string,body:unknown):RequestInit=>({method,body:JSON.stringify(body)});
export const departments=['Development','Design','QA','HR','Sales'];
export const priorities=['Low','Medium','High','Critical'];
export const employeeStatuses=['Active','Inactive','On Leave'];
export const taskStatuses=['Todo','In Progress','Completed','Cancelled'];
