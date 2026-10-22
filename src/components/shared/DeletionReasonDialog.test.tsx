import { act,fireEvent,render,screen } from "@testing-library/react";
import { beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({role:"keuangan",id:"staff",deleteData:vi.fn()}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({role:state.role,user:{id:state.id}})}));
vi.mock("@/server/dataDeletion",()=>({deleteData:state.deleteData}));
import { DeletionReasonDialog } from "./DeletionReasonDialog";
import { deleteWithApproval,deletionMessage } from "@/lib/dataDeletion";
beforeEach(()=>{state.role="keuangan";state.id="staff";state.deleteData.mockReset();state.deleteData.mockResolvedValue({pending:true,request_id:"request"});});
describe("deletion reason",()=>{
  it("requires a reason and explains that approval leaves the record intact",async()=>{
    render(<DeletionReasonDialog/>);
    let pending:Promise<any>;
    act(()=>{pending=deleteWithApproval("siswa","row");});
    expect(screen.getByRole("heading",{name:"Ajukan penghapusan"})).toBeInTheDocument();
    const submit=screen.getByRole("button",{name:"Kirim pengajuan"});
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Alasan"),{target:{value:"Duplicate record"}});
    fireEvent.click(submit);
    await expect(pending!).resolves.toEqual({pending:true,request_id:"request"});
    expect(state.deleteData).toHaveBeenCalledWith({data:{table:"siswa",id:"row",reason:"Duplicate record"}});
  });
  it("cancelling never invokes the mutation endpoint",async()=>{
    render(<DeletionReasonDialog/>);
    let pending:Promise<any>;
    act(()=>{pending=deleteWithApproval("siswa","row").catch(error=>error.message);});
    fireEvent.click(screen.getByRole("button",{name:"Batal"}));
    await expect(pending!).resolves.toContain("dibatalkan");
    expect(state.deleteData).not.toHaveBeenCalled();
  });
  it("changing the signed-in account cancels a pending deletion reason",async()=>{
    const view=render(<DeletionReasonDialog/>);
    let pending:Promise<any>;
    act(()=>{pending=deleteWithApproval("siswa","row").catch(error=>error.message);});
    state.id="other";view.rerender(<DeletionReasonDialog/>);
    await expect(pending!).resolves.toContain("dibatalkan");
    expect(state.deleteData).not.toHaveBeenCalled();
  });
  it("does not label a queued request as a completed delete",()=>{
    expect(deletionMessage({pending:true,request_id:"r"},"Deleted")).toContain("belum dihapus");
    expect(deletionMessage({pending:false,request_id:"r"},"Deleted")).toBe("Deleted");
  });
});
