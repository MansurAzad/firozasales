import { describe, it, expect, vi } from 'vitest';
import { authorizeSrPasswordReset } from './sr-password.server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
function client(admin: boolean, active: boolean, roles: string[]) {
 const rpc = vi.fn().mockResolvedValueOnce({data:admin,error:null}).mockResolvedValueOnce({error:active ? null : {message:'inactive'}});
 const eq=vi.fn().mockResolvedValue({data:roles.map(role=>({role})),error:null});
 return { rpc, from:vi.fn(()=>({select:()=>({eq})})) } as unknown as SupabaseClient<Database>;
}
describe('SR password reset authorization',()=>{
 it('allows an active admin to target SR only',async()=>{await expect(authorizeSrPasswordReset(client(true,true,['salesman']),'admin','sr')).resolves.toBeUndefined()});
 it('rejects an SR caller',async()=>{await expect(authorizeSrPasswordReset(client(false,true,['salesman']),'sr','other')).rejects.toThrow('Forbidden')});
 it('rejects an inactive admin',async()=>{await expect(authorizeSrPasswordReset(client(true,false,['salesman']),'admin','sr')).rejects.toThrow('Forbidden')});
 it('rejects resetting an admin target',async()=>{await expect(authorizeSrPasswordReset(client(true,true,['admin','salesman']),'admin','target')).rejects.toThrow('Only SR')});
 it('rejects unknown accounts',async()=>{await expect(authorizeSrPasswordReset(client(true,true,[]),'admin','missing')).rejects.toThrow('Only SR')});
});
