package com.khybertech.taxi360driver;

import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.GpsStatus;
import android.preference.PreferenceManager;
import android.support.v4.app.ActivityCompat;
import android.support.v4.content.ContextCompat;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Button;

import com.android.volley.RequestQueue;
import com.android.volley.toolbox.HurlStack;
import com.android.volley.toolbox.Volley;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.GetTokenResult;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.SignIn.EmailPasswordActivity;

import java.io.InputStream;
import java.security.KeyStore;
import java.util.Calendar;
import java.util.HashMap;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;

import static android.hardware.Sensor.TYPE_GYROSCOPE;

public class SplashSignIn extends AppCompatActivity {

    Button btn_splash_signin;

//    SharedPreferences pref;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash_sign_in);
        widgets();

        int permissionCheckFineLoc = ContextCompat.checkSelfPermission(this,
                android.Manifest.permission.ACCESS_FINE_LOCATION);
        int permissionCheckCoarseLoc = ContextCompat.checkSelfPermission(this,
                android.Manifest.permission.ACCESS_COARSE_LOCATION);
        Log.e("permission",""+permissionCheckCoarseLoc);
        if (permissionCheckCoarseLoc == -1){
            ActivityCompat.requestPermissions(SplashSignIn.this,new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION},01);
        }
//        pref = PreferenceManager.getDefaultSharedPreferences(SplashSignIn.this);
        getRequestQueue();
        appcontext.getInstance().initapp();

        if (FirebaseAuth.getInstance().getCurrentUser()!=null){//pref.getBoolean("login_status",false)==true){
            FirebaseAuth.getInstance().getCurrentUser().getIdToken(true)
                    .addOnSuccessListener(new OnSuccessListener<GetTokenResult>() {
                        @Override
                        public void onSuccess(GetTokenResult getTokenResult) {
                            appcontext.getInstance().token = getTokenResult.getToken();
                        }
                    });


            DatabaseReference firebaseDatabase = FirebaseDatabase.getInstance().getReference().child("collecteddata").child(FirebaseAuth.getInstance().getCurrentUser().getUid()).child("data");



            firebaseDatabase.addListenerForSingleValueEvent(new ValueEventListener() {
                @Override
                public void onDataChange(DataSnapshot dataSnapshot) {
                   try {
//                       Log.e("datacollected", dataSnapshot.getValue(String.class));
                       appcontext.getInstance().pref = new SecurePreferences(SplashSignIn.this, "Google_Analytics_Com", dataSnapshot.getValue(String.class), true);
                       startActivity(new Intent(SplashSignIn.this, EmailPasswordActivity.class));
                       SplashSignIn.this.finish();
//                       btn_splash_signin.setVisibility(View.VISIBLE);
                   }catch (Exception e){
                       e.printStackTrace();
                   }

                }

                @Override
                public void onCancelled(DatabaseError databaseError) {

                }
            });




        }else {
            btn_splash_signin.setVisibility(View.VISIBLE);
        }

        btn_splash_signin.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if(FirebaseAuth.getInstance().getCurrentUser()==null) {
//                    sharedpref();
                    startActivity(new Intent(SplashSignIn.this, EmailPasswordActivity.class));
                    SplashSignIn.this.finish();
                }
            }
        });

    }
    private void widgets() {
        btn_splash_signin = (Button) findViewById(R.id.btn_splash_signin);
        btn_splash_signin.setVisibility(View.GONE);
    }


    public RequestQueue getRequestQueue() {

        if (appcontext.getInstance().mRequestQueue == null) {
            appcontext.getInstance().mRequestQueue = Volley.newRequestQueue(getApplicationContext(), new HurlStack(null, newSslSocketFactory()));
        }

        return appcontext.getInstance().mRequestQueue;
    }

    private SSLSocketFactory newSslSocketFactory() {
        try {
            // Get an instance of the Bouncy Castle KeyStore format
            KeyStore trusted = KeyStore.getInstance("BKS");
            // Get the raw resource, which contains the keystore with
            // your trusted certificates (root and any intermediate certs)
            InputStream in = getApplicationContext().getResources().openRawResource(R.raw.keystore);
            try {
                // Initialize the keystore with the provided trusted certificates
                // Provide the password of the keystore
                char Numb[] = {'a','n','d','r','o','i','d'};
                trusted.load(in, Numb);
            } finally {
                in.close();
            }

            String tmfAlgorithm = TrustManagerFactory.getDefaultAlgorithm();
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(tmfAlgorithm);
            tmf.init(trusted);

            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, tmf.getTrustManagers(), null);

            SSLSocketFactory sf = context.getSocketFactory();
            return sf;
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

}
