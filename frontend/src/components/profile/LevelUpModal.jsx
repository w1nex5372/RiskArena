export default function LevelUpModal({ newLevel, onContinue }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-white rounded-[28px] p-8 mx-4 max-w-sm w-full text-center shadow-2xl">
        <div className="text-5xl mb-4">⭐</div>
        <p className="text-xs font-extrabold text-blue-600 uppercase tracking-widest mb-2">Level Up!</p>
        <h2 className="text-3xl font-extrabold text-slate-950 mb-2">You reached Level {newLevel}</h2>
        <p className="text-sm font-medium text-slate-500 mb-6">Keep playing to unlock more rewards.</p>
        <button
          onClick={onContinue}
          className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
