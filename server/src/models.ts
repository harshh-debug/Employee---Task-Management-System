import mongoose, {Schema} from 'mongoose';
import {departments,employeeStatuses,priorities,taskStatuses} from './common.js';

const employeeSchema=new Schema({
  employeeId:{type:String,required:true,unique:true},fullName:{type:String,required:true},
  email:{type:String,required:true,unique:true},phone:{type:String,required:true},
  department:{type:String,enum:departments,required:true},role:{type:String,required:true},
  joiningDate:{type:String,required:true},status:{type:String,enum:employeeStatuses,required:true},
  skills:{type:[String],default:[]},leaveStart:{type:String,default:null},leaveEnd:{type:String,default:null},
  activeTaskCount:{type:Number,default:0,select:false},version:{type:Number,default:0,select:false},
  deletedAt:{type:Date,default:null}
},{timestamps:true});
employeeSchema.index({deletedAt:1,department:1,status:1});
const taskSchema=new Schema({
  taskId:{type:String,required:true,unique:true},title:{type:String,required:true},description:{type:String,required:true},
  assignedEmployee:{type:Schema.Types.ObjectId,ref:'Employee',required:true,index:true},
  department:{type:String,enum:departments,required:true},priority:{type:String,enum:priorities,required:true},
  status:{type:String,enum:taskStatuses,default:'Todo',required:true},
  startDate:{type:String,required:true},dueDate:{type:String,required:true},completedAt:{type:Date,default:null}
},{timestamps:true});
taskSchema.index({status:1,dueDate:1});
taskSchema.index({createdAt:-1,_id:-1});
export const Employee=mongoose.model('Employee',employeeSchema);
export const Task=mongoose.model('Task',taskSchema);
