import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Icon } from '../components/Icon';

export function Welcome() {
  const navigate = useNavigate();
  const enter = () => {
    navigate('/');
  };
  return (
    <div className="page welcome-page">
      <section className="welcome-panel">
        <div className="welcome-visual">
          <img
            src="/images/himalayan-dawn.webp"
            alt="AI concept artwork of mountains glowing in the first light of dawn"
            width="1536"
            height="1024"
          />
          <span>
            <Icon name="pin" size={16} /> Sikkim, India
          </span>
        </div>
        <div className="welcome-copy">
          <div className="welcome-brand">
            <Brand />
          </div>
          <p className="eyebrow accent">YOU’RE IN GOOD COMPANY</p>
          <h1>
            Arrive curious.
            <br />
            <em>Leave connected.</em>
          </h1>
          <p>Discover. Connect. Experience Sikkim.</p>
          <button
            type="button"
            className="button button-primary"
            onClick={enter}
          >
            Continue as guest
            <Icon name="arrow-right" size={18} />
          </button>
          <span className="welcome-note">
            No account needed. Just a little curiosity.
          </span>
          <div className="welcome-benefits">
            <span>
              <Icon name="check" size={16} />
              Discover at your own pace
            </span>
            <span>
              <Icon name="check" size={16} />
              Save the things you love
            </span>
          </div>
          <Link to="/explore" className="text-link">
            Take a look around
            <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      </section>
    </div>
  );
}
