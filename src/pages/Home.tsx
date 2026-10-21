import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  return (
    <>
      <style>{`
        html, body, #root {
          margin: 0;
          height: 100%;
          font-family: Arial, Helvetica, sans-serif;
          background: linear-gradient(180deg, #d4af37 0%, #f1d67a 100%);
        }

        .home-container {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding:
            max(24px, env(safe-area-inset-top))
            20px
            max(24px, env(safe-area-inset-bottom));
          box-sizing: border-box;
          text-align: center;
        }

        .home-logo {
          width: min(70vw, 380px);
          max-height: 40vh;
          height: auto;
          object-fit: contain;
          margin-bottom: 16px;
        }

        .home-title {
          font-size: clamp(20px, 5vw, 30px);
          font-weight: 900;
          margin-bottom: 28px;
          color: #071426;
          letter-spacing: 0.5px;
        }

        .home-buttons {
          width: 100%;
          max-width: 420px;
          display: grid;
          gap: 16px;
        }

        .home-btn {
          width: 100%;
          height: clamp(60px, 10vw, 72px);
          border-radius: 20px;
          border: none;
          font-size: clamp(16px, 4vw, 20px);
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 14px 30px rgba(0,0,0,0.2);
          transition: transform 0.12s ease, filter 0.12s ease;
        }

        .home-btn:hover {
          transform: translateY(-2px);
          filter: brightness(1.05);
        }

        .home-btn:active {
          transform: scale(0.97);
        }

        .lane-btn {
          background: linear-gradient(180deg, #2f73d9 0%, #1f4f82 100%);
          color: white;
        }

        .starter-btn {
          background: linear-gradient(180deg, #43a047 0%, #1f6a35 100%);
          color: white;
        }

        .admin-btn {
          background: linear-gradient(180deg, #1e2a38 0%, #0b1f3a 100%);
          color: #f1d67a;
          border: 1px solid rgba(255,255,255,0.15);
        }

        @media (min-width: 768px) {
          .home-buttons {
            gap: 20px;
          }

          .home-btn {
            height: 72px;
          }
        }

        @media (max-width: 360px) {
          .home-logo {
            width: 80vw;
          }

          .home-title {
            font-size: 18px;
          }
        }
      `}</style>

      <div className="home-container">
        <img
          className="home-logo"
          src="https://tbspanthers.british-school.org/wp-content/uploads/2026/04/splash-swim-fan.png"
          alt="Panthers"
        />

        <div className="home-title">Swim Meet Console</div>

        <div className="home-buttons">
          <button
            className="home-btn lane-btn"
            onClick={() => navigate('/lane-timer')}
          >
            Lane Timer
          </button>

          <button
            className="home-btn starter-btn"
            onClick={() => navigate('/starter')}
          >
            Starter Console
          </button>

          <button
            className="home-btn admin-btn"
            onClick={() => navigate('/meets')}
          >
            Admin Area
          </button>
        </div>
      </div>
    </>
  );
}