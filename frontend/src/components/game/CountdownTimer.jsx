import React from 'react';

function CountdownTimer({ onComplete }) {
  const [count, setCount] = React.useState(3);

  React.useEffect(() => {
    if (count === 0) {
      onComplete();
      return;
    }

    const timer = setTimeout(() => {
      setCount(count - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [count, onComplete]);

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="text-9xl font-bold text-yellow-400 animate-pulse mb-4">
        {count}
      </div>
      <p className="text-white text-2xl font-semibold">
        {count === 3 && "Get Ready..."}
        {count === 2 && "Selecting Winner..."}
        {count === 1 && "Almost There..."}
      </p>
    </div>
  );
}

export default CountdownTimer;
