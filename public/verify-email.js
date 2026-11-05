(() => {
  const token=location.hash.slice(1);
  history.replaceState(null,'','/verify-email');
  const button=document.getElementById('verify');
  const status=document.getElementById('verification-status');
  button.onclick=async()=>{
    button.disabled=true;
    button.textContent='Wird bestätigt …';
    status.textContent='Deine E-Mail-Adresse wird bestätigt …';
    try{
      const headers={'Content-Type':'application/json'};
      const me=await fetch('/api/auth/me');
      if(me.ok)headers['X-CSRF-Token']=(await me.json()).csrf;
      const res=await fetch('/api/auth/verify-email',{method:'POST',headers,body:JSON.stringify({token})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||'Die E-Mail-Adresse konnte nicht bestätigt werden.');
      status.textContent='Deine E-Mail-Adresse ist bestätigt. Du kannst jetzt dein Konto öffnen.';
      button.hidden=true;
    }catch(error){
      status.textContent=error.message==='Failed to fetch'?'Verbindung fehlgeschlagen. Bitte erneut versuchen.':error.message||'Verbindung fehlgeschlagen. Bitte erneut versuchen.';
      button.disabled=false;
      button.textContent='Erneut versuchen';
    }
  };
})();
