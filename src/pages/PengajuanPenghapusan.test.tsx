import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({role:"keuangan",list:vi.fn(),review:vi.fn(),success:vi.fn(),warning:vi.fn(),error:vi.fn()}));
vi.mock("@/contexts/AuthContext",()=>({useAuth:()=>({role:state.role})}));
vi.mock("@/server/dataDeletion",()=>({listDeletionRequests:state.list,reviewDeletionRequest:state.review}));
vi.mock("sonner",()=>({toast:{success:state.success,warning:state.warning,error:state.error}}));
vi.mock("@/pages/Unauthorized",()=>({default:()=> <p>Unauthorized</p>}));
import PengajuanPenghapusan from "./PengajuanPenghapusan";
const row={
  id:"00000000-0000-4000-8000-000000000001",target_table:"tagihan",action:"cancel_bill",status:"pending",
  snapshot:{record:{nominal:100000,status:"belum_bayar"},context:{student_name:"Student fixture",student_nis:"26-02-001"}},
  requested_at:"2026-10-21T01:00:00Z",reason:"Wrong bill entry",requester:{email:"staff@test.invalid",role:"keuangan"},
};
beforeEach(()=>{
  state.role="keuangan";state.list.mockReset();state.review.mockReset();
  state.success.mockReset();state.warning.mockReset();state.error.mockReset();
  state.list.mockResolvedValue({items:[row],hasMore:false});
  state.review.mockResolvedValue({status:"approved"});
});
function show(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PengajuanPenghapusan/></QueryClientProvider>);}
describe("request review UI",()=>{
  it("staff can inspect their request without approval controls",async()=>{
    show();
    fireEvent.click(await screen.findByRole("button",{name:"Lihat detail"}));
    expect(screen.queryByRole("button",{name:"Setujui dan jalankan"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Tolak"})).not.toBeInTheDocument();
    expect(screen.getByText(/26-02-001/)).toBeInTheDocument();
  });
  it("admin must enter a note before approving the exact selected request",async()=>{
    state.role="admin";show();
    fireEvent.click(await screen.findByRole("button",{name:"Periksa pengajuan"}));
    const approve=screen.getByRole("button",{name:"Setujui dan jalankan"});
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Catatan keputusan"),{target:{value:"Checked against receipt"}});
    fireEvent.click(approve);
    await waitFor(()=>expect(state.review).toHaveBeenCalledWith({data:{id:row.id,approve:true,note:"Checked against receipt"}}));
    await waitFor(()=>expect(state.success).toHaveBeenCalled());
  });
  it("explains stale data and does not report a deletion as successful",async()=>{
    state.role="admin";state.review.mockResolvedValue({status:"changed"});show();
    fireEvent.click(await screen.findByRole("button",{name:"Periksa pengajuan"}));
    fireEvent.change(screen.getByLabelText("Catatan keputusan"),{target:{value:"Checked current bill"}});
    fireEvent.click(screen.getByRole("button",{name:"Setujui dan jalankan"}));
    await waitFor(()=>expect(state.warning).toHaveBeenCalledWith(expect.stringContaining("tidak dijalankan")));
    expect(state.success).not.toHaveBeenCalled();
  });
  it("can paginate pending requests instead of hiding older ones",async()=>{
    state.list.mockResolvedValue({items:[row],hasMore:true});show();
    fireEvent.click(await screen.findByRole("button",{name:"Berikutnya"}));
    await waitFor(()=>expect(state.list).toHaveBeenCalledWith({data:{status:"pending",page:1}}));
  });
});
