import express, {ErrorRequestHandler,RequestHandler} from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import {ZodError} from 'zod';
import {ApiError} from './common.js';
import {createEmployee,createTask,deleteEmployee,deleteTask,getEmployee,getTask,updateEmployee,updateTask,changeStatus} from './services.js';
import {dashboard,exportTasks,listEmployees,listTasks} from './queries.js';

const wrap=(fn:RequestHandler):RequestHandler=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export function createApp(origin=process.env.CLIENT_ORIGIN||'http://localhost:5173'){
 const app=express();
 app.use(cors({origin:origin.split(',').map(x=>x.trim())}));app.use(express.json({limit:'1mb'}));
 app.get('/api/health',wrap(async(_req,res)=>{const ready=mongoose.connection.readyState===1;res.status(ready?200:503).json({status:ready?'ok':'unavailable',database:ready?'connected':'disconnected'});}));
 app.get('/api/employees',wrap(async(req,res)=>{res.json(await listEmployees(req.query));}));
 app.post('/api/employees',wrap(async(req,res)=>{res.status(201).json({data:await createEmployee(req.body)});}));
 app.get('/api/employees/:id',wrap(async(req,res)=>{res.json({data:await getEmployee(String(req.params.id))});}));
 app.put('/api/employees/:id',wrap(async(req,res)=>{res.json({data:await updateEmployee(String(req.params.id),req.body)});}));
 app.delete('/api/employees/:id',wrap(async(req,res)=>{await deleteEmployee(String(req.params.id));res.status(204).end();}));
 app.get('/api/tasks/export',wrap(async(req,res)=>{const csv=await exportTasks(req.query);res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="tasks.csv"');res.send(csv);}));
 app.get('/api/tasks',wrap(async(req,res)=>{res.json(await listTasks(req.query));}));
 app.post('/api/tasks',wrap(async(req,res)=>{res.status(201).json({data:await createTask(req.body)});}));
 app.get('/api/tasks/:id',wrap(async(req,res)=>{res.json({data:await getTask(String(req.params.id))});}));
 app.put('/api/tasks/:id/status',wrap(async(req,res)=>{res.json({data:await changeStatus(String(req.params.id),req.body)});}));
 app.put('/api/tasks/:id',wrap(async(req,res)=>{res.json({data:await updateTask(String(req.params.id),req.body)});}));
 app.delete('/api/tasks/:id',wrap(async(req,res)=>{await deleteTask(String(req.params.id));res.status(204).end();}));
 app.get('/api/dashboard',wrap(async(_req,res)=>{res.json({data:await dashboard()});}));
 app.use((_req,res)=>{res.status(404).json({error:{code:'NOT_FOUND',message:'Route not found.',fields:{}}});});
 const onError:ErrorRequestHandler=(err, _req,res,_next)=>{
   void _next;
   if(err instanceof ApiError){res.status(err.status).json({error:{code:err.code,message:err.message,fields:err.fields}});return;}
   if(err instanceof ZodError){res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid input.',fields:{}}});return;}
   if(err?.code===11000){const field=Object.keys(err.keyPattern||{})[0]||'employeeId';res.status(409).json({error:{code:'DUPLICATE_VALUE',message:field+' is already in use.',fields:{[field]:'Already in use.'}}});return;}
   console.error(err);res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Something went wrong. Please try again.',fields:{}}});
 };
 app.use(onError);return app;
}
