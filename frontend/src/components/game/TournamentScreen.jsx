import { ChevronLeft, Trophy } from 'lucide-react';
import { Button } from '../ui/button';

export default function TournamentScreen({ user, setActiveTab }) {
  return (
    <div className="space-y-4 text-slate-900">
      <div className="rounded-[24px] bg-white border border-blue-100 p-8 shadow-[0_12px_30px_rgba(37,99,235,0.08)] text-center">
        <div className="w-20 h-20 rounded-[24px] bg-gradient-to-br from-indigo-100 to-blue-50 flex items-center justify-center mx-auto mb-5">
          <Trophy className="w-10 h-10 text-indigo-500" />
        </div>
        <p className="text-xs font-extrabold text-indigo-600 uppercase tracking-widest mb-2">Tournament</p>
        <h2 className="text-2xl font-extrabold text-slate-950 mb-2">Coming Soon</h2>
        <p className="text-sm font-medium text-slate-500 max-w-xs mx-auto leading-relaxed">
          Bracket tournaments are in development. Top players will compete for exclusive prizes once they launch.
        </p>

        <div className="mt-6 rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 inline-flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-xs font-extrabold text-indigo-700">In development — stay tuned</span>
        </div>

        {setActiveTab && (
          <div className="mt-6">
            <Button
              onClick={() => setActiveTab('rooms')}
              variant="outline"
              className="rounded-2xl border-slate-200 text-slate-700 hover:bg-slate-50 font-extrabold h-12 px-6"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back to Rooms
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
