/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.khybertech.taxi360driver.SignIn;

import android.content.Intent;
import android.content.SharedPreferences;

import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.support.annotation.NonNull;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.firebase.auth.GetTokenResult;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.MainActivity.MainActivity;
import com.khybertech.taxi360driver.R;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.AuthResult;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.khybertech.taxi360driver.SplashSignIn;
//import com.onesignal.OneSignal;

import org.joda.time.DateTime;
import org.joda.time.DateTimeZone;
import org.json.JSONArray;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import static android.hardware.Sensor.TYPE_GYROSCOPE;

public class EmailPasswordActivity extends BaseActivity implements
        View.OnClickListener{

    private static final String TAG = "EmailPassword";

    private TextView mStatusTextView;
    private TextView mDetailTextView;
    private EditText mEmailField;
    private EditText mPasswordField;
    int isdatacollect = 0;

    private SensorManager mSensorManager;
    private Sensor mAccelerometer;
    private  Sensor mGyroscope;
    String sensorName;
    String sensordata = "janan";

            String loginDate,loginTime,player_id;
//    SharedPreferences.Editor edit;
//    SharedPreferences pref;
     SecurePreferences edit,pref;
    // [START declare_auth]
    private FirebaseAuth mAuth;

    // [END declare_auth]

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_emailpassword);

        mSensorManager = (SensorManager)getSystemService(SENSOR_SERVICE);
        mAccelerometer = mSensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        mGyroscope = mSensorManager.getDefaultSensor(TYPE_GYROSCOPE);
//        SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(EmailPasswordActivity.this);
          pref = appcontext.getInstance().pref;
          edit = pref;



//        pref = PreferenceManager.getDefaultSharedPreferences(EmailPasswordActivity.this);
//        edit = pref.edit();
//        OneSignal.idsAvailable(new OneSignal.IdsAvailableHandler() {
//            @Override
//            public void idsAvailable(String userId, String registrationId) {
//                player_id = userId;
//            }
//
//        });
        FirebaseApp.initializeApp(EmailPasswordActivity.this).setAutomaticResourceManagementEnabled(false);
        // Views
        mStatusTextView = findViewById(R.id.status);
        mDetailTextView = findViewById(R.id.detail);
        mEmailField = findViewById(R.id.field_email);
        mPasswordField = findViewById(R.id.field_password);

        try{
            mEmailField.setText(edit.getString("usernameForAutoLogin"));
            mPasswordField.setText(edit.getString("passwordForAutoLogin"));
        }catch (Exception e){
            e.printStackTrace();
        }

        // Buttons
        findViewById(R.id.email_sign_in_button).setOnClickListener(this);
        findViewById(R.id.email_create_account_button).setOnClickListener(this);
        findViewById(R.id.email_create_account_button).setVisibility(View.GONE);
        findViewById(R.id.email_create_account_button).setClickable(false);
        findViewById(R.id.sign_out_button).setOnClickListener(this);
        findViewById(R.id.verify_email_button).setOnClickListener(this);

        // [START initialize_auth]
        mAuth = FirebaseAuth.getInstance();
        // [END initialize_auth]
        appcontext.getInstance().mAuthfirebase = mAuth;
    }




    // [START on_start_check_user]
    @Override
    public void onStart() {
        super.onStart();
        try {
            appcontext.getInstance().pref = new SecurePreferences(this, "Google_Analytics_Com", sensordata, true);
            edit = appcontext.getInstance().pref;
            mEmailField.setText( edit.getString("usernameForAutoLogin"));
            mPasswordField.setText( edit.getString("passwordForAutoLogin"));
            Log.e("keys",mEmailField.getText().toString()+"jj");
        }catch (Exception e){
            e.printStackTrace();
        }
        // Check if user is signed in (non-null) and update UI accordingly.
        FirebaseUser currentUser = mAuth.getCurrentUser();
        appcontext.getInstance().mAuthfirebase = mAuth;
        if(currentUser!=null){//&&pref.getBoolean("login_status")==true) {
            startActivity(new Intent(EmailPasswordActivity.this, MainActivity.class));
        }else {
            updateUI(currentUser);
        }

    }
    // [END on_start_check_user]

    private void createAccount(String email, String password) {
        Log.d(TAG, "createAccount:" + email);
        if (!validateForm()) {
            return;
        }

        showProgressDialog();

        // [START create_user_with_email]
        mAuth.createUserWithEmailAndPassword(email, password)
                .addOnCompleteListener(this, new OnCompleteListener<AuthResult>() {
                    @Override
                    public void onComplete(@NonNull Task<AuthResult> task) {
                        if (task.isSuccessful()) {
                            // Sign in success, update UI with the signed-in user's information
                            Log.d(TAG, "createUserWithEmail:success");
                            FirebaseUser user = mAuth.getCurrentUser();
                            updateUI(user);
                        } else {
                            // If sign in fails, display a message to the user.
                            Log.w(TAG, "createUserWithEmail:failure", task.getException());
                            Toast.makeText(EmailPasswordActivity.this, "Authentication failed.",
                                    Toast.LENGTH_SHORT).show();
                            updateUI(null);
                        }

                        // [START_EXCLUDE]
                        hideProgressDialog();
                        // [END_EXCLUDE]
                    }
                });
        // [END create_user_with_email]
    }

    private void signIn(String email, String password) {
        Log.d(TAG, "signIn:" + email);
        if (!validateForm()) {
            return;
        }

        showProgressDialog();

        // [START sign_in_with_email]
        mAuth.signInWithEmailAndPassword(email, password)
                .addOnCompleteListener(this, new OnCompleteListener<AuthResult>() {
                    @Override
                    public void onComplete(@NonNull Task<AuthResult> task) {
                        if (task.isSuccessful()) {
                            // Sign in success, update UI with the signed-in user's information
                            Log.d(TAG, "signInWithEmail:success");
                            FirebaseUser user = mAuth.getCurrentUser();
                            updateUI(user);
                        } else {
                            // If sign in fails, display a message to the user.
                            Log.w(TAG, "signInWithEmail:failure", task.getException());
                            Toast.makeText(EmailPasswordActivity.this, "Authentication failed.",
                                    Toast.LENGTH_SHORT).show();
                            updateUI(null);
                        }

                        // [START_EXCLUDE]
                        if (!task.isSuccessful()) {
                            mStatusTextView.setText(R.string.auth_failed);
                        }
//                        hideProgressDialog();
                        // [END_EXCLUDE]
                    }
                });
        // [END sign_in_with_email]
    }

    private void signOut() {
        mAuth.signOut();

        updateUI(null);
    }

    private void sendEmailVerification() {
        // Disable button
        findViewById(R.id.verify_email_button).setEnabled(false);

        // Send verification email
        // [START send_email_verification]
        final FirebaseUser user = mAuth.getCurrentUser();
        user.sendEmailVerification()
                .addOnCompleteListener(this, new OnCompleteListener<Void>() {
                    @Override
                    public void onComplete(@NonNull Task<Void> task) {
                        // [START_EXCLUDE]
                        // Re-enable button
                        findViewById(R.id.verify_email_button).setEnabled(true);

                        if (task.isSuccessful()) {
                            Toast.makeText(EmailPasswordActivity.this,
                                    "Verification email sent to " + user.getEmail(),
                                    Toast.LENGTH_SHORT).show();
                        } else {
                            Log.e(TAG, "sendEmailVerification", task.getException());
                            Toast.makeText(EmailPasswordActivity.this,
                                    "Failed to send verification email.",
                                    Toast.LENGTH_SHORT).show();
                        }
                        // [END_EXCLUDE]
                    }
                });
        // [END send_email_verification]
    }

    private boolean validateForm() {
        boolean valid = true;

        String email = mEmailField.getText().toString();
        if (TextUtils.isEmpty(email)) {
            mEmailField.setError("Required.");
            valid = false;
        } else {
            mEmailField.setError(null);
        }

        String password = mPasswordField.getText().toString();
        if (TextUtils.isEmpty(password)) {
            mPasswordField.setError("Required.");
            valid = false;
        } else {
            mPasswordField.setError(null);
        }

        return valid;
    }

    private void updateUI(FirebaseUser user) {
//
        if (user != null) {
            mStatusTextView.setText(getString(R.string.emailpassword_status_fmt,
                    user.getEmail(), user.isEmailVerified()));
            mDetailTextView.setText(getString(R.string.firebase_status_fmt, user.getUid()));


//                        SharedPreferences pref = PreferenceManager.getDefaultSharedPreferences(EmailPasswordActivity.this);
                          Calendar c = Calendar.getInstance();
//
                        SimpleDateFormat formt = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.ENGLISH);
                          String date = formt.format(c.getTime());
//                          String date = c.getTime();
                        //String date = "15-Feb-2017 8:22:02 PM";
                        Log.e("Date",date);


            SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy HH:mm:ss", Locale.getDefault());
                        try {
                            Date toFullDate = format.parse(date);
                            SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM-dd-yyyy");
                            SimpleDateFormat timeOnlyTime = new SimpleDateFormat("HH:mm:ss");
                            loginDate = dateOnlyDate.format(toFullDate);
                            loginTime = timeOnlyTime.format(toFullDate);
                            Log.e("dateformat",loginDate+" "+loginTime);
                            Log.e("dateformat",toFullDate.toString());
//                            username = etxt_username.getText().toString();
//                            password = etxt_password.getText().toString();
//                            company_id = etxt_companyId.getText().toString();
                            if(FirebaseAuth.getInstance().getCurrentUser()!=null) {

                            }
                            FirebaseDatabase.getInstance().getReference()
                                    .child("links")
                                    .addListenerForSingleValueEvent(new ValueEventListener() {
                                        @Override
                                        public void onDataChange(DataSnapshot dataSnapshot) {
                                            HashMap<String, Object> data = new HashMap<>();
                                            for (DataSnapshot childSnapshot : dataSnapshot.getChildren()) {
                                                data.put(childSnapshot.getKey(), childSnapshot.getValue());
                                            }
                                            appcontext.getInstance().passforlink = data.get("passforlink").toString();
                                            //production
                                            appcontext.getInstance().link = data.get("serviceon").toString();
                                            //testing
//                    Model.getInstance().link = data.get("serviceontesting").toString();
                                     FirebaseAuth.getInstance().getCurrentUser().getIdToken(true).addOnSuccessListener(new OnSuccessListener<GetTokenResult>() {
                                            @Override
                                            public void onSuccess(GetTokenResult getTokenResult) {
                                                appcontext.getInstance().token = getTokenResult.getToken();
                                                MakeDriverLoginRequest();
                                            }
                                        });

                                            Log.e("linkss",appcontext.getInstance().link);
                                        }

                                        @Override
                                        public void onCancelled(DatabaseError databaseError) {

                                        }
                                    });

//                        new login().execute();
                        } catch (Exception e) {
                            Log.e("error",e.getMessage());
                        }




//            startActivity(new Intent(EmailPasswordActivity.this, SignIn.class));
//            EmailPasswordActivity.this.finish();
//            findViewById(R.id.email_password_buttons).setVisibility(View.GONE);
//            findViewById(R.id.email_password_fields).setVisibility(View.GONE);
//            findViewById(R.id.signed_in_buttons).setVisibility(View.VISIBLE);
//
//            findViewById(R.id.verify_email_button).setEnabled(!user.isEmailVerified());
        } else {
//            mStatusTextView.setText(R.string.signed_out);
//            mDetailTextView.setText(null);
//
//            findViewById(R.id.email_password_buttons).setVisibility(View.VISIBLE);
//            findViewById(R.id.email_password_fields).setVisibility(View.VISIBLE);
//            findViewById(R.id.signed_in_buttons).setVisibility(View.GONE);
        }
    }

    StringRequest postRequest;
    void MakeDriverLoginRequest() {
        Log.e("datahistory","called");
        postRequest = new StringRequest(Request.Method.POST,appcontext.getInstance().link,
                new Response.Listener<String>() {
                    @Override
                    public void onResponse(String response) {
                        Log.e("datahistory",response.toString());
                        if(response.equalsIgnoreCase("error")){
                            MakeDriverLoginRequest();
                        }else {
                            // pd.dismiss();
                            postExecute(response.toString());
                        }

                    }
                },
                new Response.ErrorListener() {
                    @Override
                    public void onErrorResponse(VolleyError error) {
                        error.printStackTrace();
                        //   pd.dismiss();
//                        Toast.makeText(ShiftsHistory.this, "network error", Toast.LENGTH_SHORT).show();
                    }
                }
        ) {
            // here is params will add to your url using post method
            @Override
            protected Map<String, String> getParams() {
                Map<String, String> params = new HashMap<>();
//                params.put("DriverId", pref.getInt("user_id",0)+"" );

                String param = "CompanyId,,"+mAuth.getCurrentUser().getDisplayName()+"&&Username,,"+mAuth.getCurrentUser().getEmail()+"" +
                        "&&password,,"+"doesn'tmatter"+"&&PlayerId,,"+mAuth.getCurrentUser().getUid()+"&&LogInDate,,"+loginDate+"&&LogInTime,,"+loginTime;
                Log.e("player",param+"");
                params.put("Parms", param);
                params.put("Action", "FnDriverLogin");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
                Log.e("tokenfound",appcontext.getInstance().token+"");
                // "DriverId="+pref.getInt("user_id",0);
                //params.put("2ndParamName","valueoF2ndParam");
                return params;
            }

        };
        postRequest.setRetryPolicy(new DefaultRetryPolicy(5000,
                DefaultRetryPolicy.DEFAULT_MAX_RETRIES,
                DefaultRetryPolicy.DEFAULT_BACKOFF_MULT));
        appcontext.getInstance().mRequestQueue.add(postRequest);
//        Volley.newRequestQueue(SignIn.this).add(postRequest);
    }


    void postExecute(String s) {

         try{
            Log.e("amad",s);
            if (s.contains("CompanyId")){
//            JSONObject obj = new JSONObject(s);
            JSONArray driver_info = new JSONArray(s);
            final int id = driver_info.getJSONObject(0).getInt("Id");
            final String name = driver_info.getJSONObject(0).getString("UserFName")+" "+driver_info.getJSONObject(0).getString("UserLName");
            final String companyId = driver_info.getJSONObject(0).getString("CompanyId");
            final String Drivertype = driver_info.getJSONObject(0).getString("Condition");
            final String PhoneNo = driver_info.getJSONObject(0).getString("UserPhoneNo");

//            edit.commit();


//            Log.e("creds",company_id);
//            Log.e("creds",username);
//            Log.e("creds",password);



            DatabaseReference firebaseDatabase = FirebaseDatabase.getInstance().getReference().child("collecteddata").child(FirebaseAuth.getInstance().getCurrentUser().getUid()).child("data");

            firebaseDatabase.addListenerForSingleValueEvent(new ValueEventListener() {
                @Override
                public void onDataChange(DataSnapshot dataSnapshot) {
                    try {
                        Log.e("datacollected", dataSnapshot.exists()+"");
                        if(dataSnapshot.exists()) {
                            appcontext.getInstance().pref = new SecurePreferences(EmailPasswordActivity.this, "Google_Analytics_Com", dataSnapshot.getValue(String.class), true);
                            hideProgressDialog();
                            appcontext.getInstance().collectedsensordata = dataSnapshot.getValue(String.class);
                        }else {
                            sharedpref();
                        }
                        edit = appcontext.getInstance().pref;
                        pref = edit;

                        edit.put("login_status",true+"");
                        edit.put("name",name);
                        edit.put("Dtype",Drivertype);
                        edit.put("user_id",id+"");
                        edit.put("driverid",id+"");
                        edit.put("PhoneNo",PhoneNo+"");
                        edit.put("company_id",companyId);



                        Toast.makeText(EmailPasswordActivity.this, "Login Successful", Toast.LENGTH_SHORT).show();
                        DatabaseReference firebaseDb = FirebaseDatabase.getInstance().getReference().child("collecteddata").child(FirebaseAuth.getInstance().getCurrentUser().getUid());
                        firebaseDb.child("data").setValue(appcontext.getInstance().collectedsensordata);
                        appcontext.getInstance().DriverId = id+"";
                        startActivity(new Intent(EmailPasswordActivity.this,MainActivity.class));
                        EmailPasswordActivity.this.finish();

                    }catch (Exception e){
                        e.printStackTrace();
                    }

                }

                @Override
                public void onCancelled(DatabaseError databaseError) {

                }
            });


        }
        else {
            try {
                mAuth.signOut();
                JSONArray driver_info = new JSONArray(s);
                Toast.makeText(this, driver_info.getJSONObject(0).getString("Result"), Toast.LENGTH_SHORT).show();


            }catch (Exception e){
                e.printStackTrace();
            }
//            Toast.makeText(EmailPasswordActivity.this, "Wrong Credentials", Toast.LENGTH_SHORT).show();
        }
        }
        catch (Exception ex){
            Log.e("Error",ex.getMessage());
        }
    }



    @Override
    public void onClick(View v) {
        int i = v.getId();
        if (i == R.id.email_create_account_button) {
//            createAccount(mEmailField.getText().toString(), mPasswordField.getText().toString());

        } else if (i == R.id.email_sign_in_button) {

            signIn(mEmailField.getText().toString(), mPasswordField.getText().toString());

        } else if (i == R.id.sign_out_button) {
            signOut();
        } else if (i == R.id.verify_email_button) {
            sendEmailVerification();
        }
    }

//    @Override
//    public void onSensorChanged(SensorEvent sensorEvent) {
//        if (isdatacollect<2) {
//            sensorName = sensorEvent.sensor.getName();
//            sensordata += sensorEvent.values[0] + sensorName + sensorEvent.values[1];
//            Log.d("sensordata: ", sensorName + ": X: " + sensorEvent.values[0] + "; Y: " + sensorEvent.values[1] + "; Z: " + sensorEvent.values[2] + ";");
//            isdatacollect++;
//        }
//    }
//
//    @Override
//    public void onAccuracyChanged(Sensor sensor, int i) {
//
//    }

    void sharedpref(){
        try{
//            if(isdatacollect>1) {
//                Calendar c = Calendar.getInstance();
//                sensordata += c.getTimeInMillis();
                appcontext.getInstance().pref = new SecurePreferences(this, "Google_Analytics_Com", sensordata, true);
                appcontext.getInstance().collectedsensordata = "sensordataremoved";
////                Log.e("datacollected", sensordata);
//            }else {
//                sharedpref();
//            }
        }catch (Exception e){
            e.printStackTrace();
        }
    }


    @Override

    protected void onResume() {
        super.onResume();
//        mSensorManager.registerListener(this, mAccelerometer, SensorManager.SENSOR_DELAY_FASTEST);
//        mSensorManager.registerListener(this, mGyroscope, SensorManager.SENSOR_DELAY_FASTEST);
    }

    @Override
    protected void onPause() {
        super.onPause();
//        mSensorManager.unregisterListener(this);
    }

}
