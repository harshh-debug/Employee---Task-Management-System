import dotenv from 'dotenv';
dotenv.config({path:'../.env'});
dotenv.config({path:'.env'});
export function config(){
  const uri=process.env.MONGODB_URI;
  if(!uri)throw new Error('MONGODB_URI is required.');
  if(process.env.BUSINESS_TIMEZONE && process.env.BUSINESS_TIMEZONE!=='UTC')throw new Error('BUSINESS_TIMEZONE must be UTC.');
  const port=Number(process.env.PORT||5000);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port.');
  const origin=process.env.CLIENT_ORIGIN||'http://localhost:5173';
  if(process.env.NODE_ENV==='production'&&!process.env.CLIENT_ORIGIN)throw new Error('CLIENT_ORIGIN is required in production.');
  return {uri,port,origin};
}
