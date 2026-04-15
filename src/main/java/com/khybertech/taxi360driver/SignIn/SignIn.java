package com.khybertech.taxi360driver.SignIn;

import android.app.ProgressDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.AsyncTask;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import com.android.volley.DefaultRetryPolicy;
import com.android.volley.Request;
import com.android.volley.Response;
import com.android.volley.VolleyError;
import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;
import com.khybertech.taxi360driver.MainActivity.MainActivity;
import com.khybertech.taxi360driver.R;
import com.khybertech.taxi360driver.SplashSignIn;
//import com.onesignal.OneSignal;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class SignIn extends AppCompatActivity {

    String player_id,username,password,company_id,loginDate,loginTime;
    Toolbar toolbar_signin;
    EditText etxt_companyId, etxt_username, etxt_password;
    Button btn_signin;
    SecurePreferences pref;
    SecurePreferences edit;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_sign_in);
//        pref = PreferenceManager.getDefaultSharedPreferences(SignIn.this);
        pref = appcontext.getInstance().pref;
        edit = pref;
        Calendar c = Calendar.getInstance();
        SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy KK:mm:ss a", Locale.ENGLISH);
        //String currentDateTime = DateFormat.getDateTimeInstance().format(new Date());
        String currentDateTime = format.format(c.getTime());
        Log.e("amadDD",currentDateTime);
        edit.put("user_date",currentDateTime.replace("p.m.","PM").replace("a.m.","AM"));
//        edit.commit();
//        OneSignal.idsAvailable(new OneSignal.IdsAvailableHandler() {
//            @Override
//            public void idsAvailable(String userId, String registrationId) {
//                player_id = userId;
//            }
//        });
        widgets();
        toolbarSetting();
        Log.e("pref",""+pref.getString("doLoginCredExists"));
        if (pref.getString("doLoginCredExists").equalsIgnoreCase("1")){
            Toast.makeText(this, "Exists", Toast.LENGTH_SHORT).show();
            etxt_companyId.setText(pref.getString("companyIdForAutoLogin"));
            etxt_username.setText(pref.getString("usernameForAutoLogin"));
            etxt_password.setText(pref.getString("passwordForAutoLogin"));
        }
        else {
            Toast.makeText(this, "Does not exists", Toast.LENGTH_SHORT).show();
        }
        btn_signin.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (etxt_companyId.getText().toString().equals("")){
                    Toast.makeText(SignIn.this, "Enter Company ID", Toast.LENGTH_SHORT).show();
                }
                else if (etxt_username.getText().toString().equals("")){
                    Toast.makeText(SignIn.this, "Enter Username", Toast.LENGTH_SHORT).show();
                }
                else if (etxt_password.getText().toString().equals("")){
                    Toast.makeText(SignIn.this, "Enter Password", Toast.LENGTH_SHORT).show();
                }
                else {
                    String date = pref.getString("user_date");
                    //String date = "15-Feb-2017 8:22:02 PM";
                    Log.e("Date",date);
                    SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy kk:mm:ss", Locale.ENGLISH);
                    try {
                        Date toFullDate = format.parse(date);
                        SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM-dd-yyyy");
                        SimpleDateFormat timeOnlyTime = new SimpleDateFormat("kk:mm:ss");
                        loginDate = dateOnlyDate.format(toFullDate);
                        loginTime = timeOnlyTime.format(toFullDate).replace(".","");
                        Log.e("dateformat",loginDate+" "+loginTime);
                        username = etxt_username.getText().toString();
                        password = etxt_password.getText().toString();
                        company_id = etxt_companyId.getText().toString();
                        MakeDriverLoginRequest();
//                        new login().execute();
                    } catch (ParseException e) {
                        Log.e("error",e.getMessage());
                    }
                }
            }
        });
        etxt_password.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView textView, int i, KeyEvent keyEvent) {
                if (i == EditorInfo.IME_ACTION_DONE) {
                    if (etxt_companyId.getText().toString().equals("")){
                        Toast.makeText(SignIn.this, "Enter Company ID", Toast.LENGTH_SHORT).show();
                    }
                    else if (etxt_username.getText().toString().equals("")){
                        Toast.makeText(SignIn.this, "Enter Username", Toast.LENGTH_SHORT).show();
                    }
                    else if (etxt_password.getText().toString().equals("")){
                        Toast.makeText(SignIn.this, "Enter Password", Toast.LENGTH_SHORT).show();
                    }
                    else {
                        String date = pref.getString("user_date");
                        //String date = "15-Feb-2017 8:22:02 PM";
                        Log.e("Date",date);
                        SimpleDateFormat format = new SimpleDateFormat("dd-MMM-yyyy h:mm:ss a", Locale.ENGLISH);
                        try {
                            Date toFullDate = format.parse(date);
                            SimpleDateFormat dateOnlyDate = new SimpleDateFormat("MM/dd/yyyy");
                            SimpleDateFormat timeOnlyTime = new SimpleDateFormat("KK:mm a");
                            loginDate = dateOnlyDate.format(toFullDate);
                            loginTime = timeOnlyTime.format(toFullDate).replace(".","");
                            username = etxt_username.getText().toString();
                            password = etxt_password.getText().toString();
                            company_id = etxt_companyId.getText().toString();
                            MakeDriverLoginRequest();
//                            new login().execute();
                        } catch (ParseException e) {
                            Log.e("error",e.getMessage());
                        }
                    }
                    return true;
                }
                return false;
            }
        });
    }

    private void widgets() {
        toolbar_signin = (Toolbar) findViewById(R.id.toolbar_signin);
        etxt_companyId = (EditText) findViewById(R.id.etxt_signin_companyId);
        etxt_password = (EditText) findViewById(R.id.etxt_signin_password);
        etxt_username = (EditText) findViewById(R.id.etxt_signin_username);
        btn_signin = (Button) findViewById(R.id.btn_signin_signin);
    }

    @Override
    protected void onStart() {
        super.onStart();

        if (appcontext.getInstance().mAuthfirebase.getCurrentUser() != null) {

            etxt_companyId.setText(appcontext.getInstance().mAuthfirebase.getCurrentUser().getDisplayName());
            etxt_username.setText(appcontext.getInstance().mAuthfirebase.getCurrentUser().getEmail());
            etxt_password.setText(appcontext.getInstance().mAuthfirebase.getCurrentUser().getDisplayName());

            btn_signin.performClick();
        }
    }

    private void toolbarSetting(){
        toolbar_signin.setTitle("Sign In");
        toolbar_signin.setNavigationIcon(R.drawable.back_icon);
        toolbar_signin.setNavigationOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                startActivity(new Intent(SignIn.this, SplashSignIn.class));
            }
        });
    }
StringRequest postRequest;
    void MakeDriverLoginRequest() {
        Log.e("datahistory","called");
        postRequest = new StringRequest(Request.Method.POST, appcontext.getInstance().link,
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
                String param = "CompanyId,,"+company_id+"&&Username,,"+username+"" +
                        "&&password,,"+password+"&&PlayerId,,"+player_id+"&&LogInDate,,"+loginDate+"&&LogInTime,,"+loginTime;

                params.put("Parms", param);
                params.put("Action", "FnDriverLogin");
                params.put("UserKey", appcontext.getInstance().passforlink);
                params.put("Token", appcontext.getInstance().token);
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
//            JSONObject obj = new JSONObject(s);
            JSONArray driver_info = new JSONArray(s);
            int id = driver_info.getJSONObject(0).getInt("Id");
            String name = driver_info.getJSONObject(0).getString("UserFName")+" "+driver_info.getJSONObject(0).getString("UserLName");
            String companyId = driver_info.getJSONObject(0).getString("CompanyId");
            edit.put("login_status",true+"");
            edit.put("name",name);
            edit.put("user_id",id+"");
            edit.put("company_id",companyId);
//            edit.commit();
        }
        catch (Exception ex){
            Log.e("Error",ex.getMessage());
        }
        if (s.contains("CompanyId")){
            Log.e("creds",company_id);
            Log.e("creds",username);
            Log.e("creds",password);
            edit.put("doLoginCredExists","1");
            edit.put("companyIdForAutoLogin",company_id);
            edit.put("usernameForAutoLogin",username);
            edit.put("passwordForAutoLogin",password);
//            edit.commit();
            Toast.makeText(SignIn.this, "Login Successful", Toast.LENGTH_SHORT).show();
            startActivity(new Intent(SignIn.this,MainActivity.class));
            SignIn.this.finish();
        }
        else {
            Toast.makeText(SignIn.this, "Wrong Credentials", Toast.LENGTH_SHORT).show();
        }
    }


    public class login extends AsyncTask<Void,Void,String>{
        String data="";
        ProgressDialog pd;
        @Override
        protected void onPreExecute() {
            pd = ProgressDialog.show(SignIn.this,"Cabs Wiki","Logging In!",false,false);
        }

        @Override
        protected String doInBackground(Void... voids) {
            try {
                URL url = new URL(appcontext.getInstance().link);//"http://webservices.360taxitaxi.co.nz/api/DriverApp/FnDriverLogin");
                String params = "CompanyId="+company_id+"&Username="+username+"&password="+password+"&PlayerId="+player_id+"&LogInDate="+loginDate+"&LogInTime="+loginTime;
                Log.e("params",params);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                OutputStreamWriter writer = new OutputStreamWriter(conn.getOutputStream());
                writer.write(params);
                writer.flush();
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(),"UTF-8"));
                data = reader.readLine();
                writer.close();
                reader.close();
            }
            catch (Exception ex){
                Log.e("Taxi360taxi",ex.getMessage());
            }
            return data;
        }

        @Override
        protected void onPostExecute(String s) {
            super.onPostExecute(s);
            pd.dismiss();
            try{
                Log.e("amad",s);
                JSONObject obj = new JSONObject(s);
                JSONArray driver_info = obj.getJSONArray("DriverInfo");
                int id = driver_info.getJSONObject(0).getInt("Id");
                String name = driver_info.getJSONObject(0).getString("UserFName")+" "+driver_info.getJSONObject(0).getString("UserLName");
                String companyId = driver_info.getJSONObject(0).getString("CompanyId");
                edit.put("login_status",true+"");
                edit.put("name",name);
                edit.put("user_id",id+"");
                edit.put("company_id",companyId);
//                edit.commit();
            }
            catch (Exception ex){
                Log.e("Error",ex.getMessage());
            }
            if (s.contains("DriverInfo")){
                Log.e("creds",company_id);
                Log.e("creds",username);
                Log.e("creds",password);
                edit.put("doLoginCredExists","1");
                edit.put("companyIdForAutoLogin",company_id);
                edit.put("usernameForAutoLogin",username);
                edit.put("passwordForAutoLogin",password);
//                edit.commit();
                Toast.makeText(SignIn.this, "Login Successful", Toast.LENGTH_SHORT).show();
                startActivity(new Intent(SignIn.this,MainActivity.class));
                SignIn.this.finish();
            }
            else {
                Toast.makeText(SignIn.this, "Wrong Credentials", Toast.LENGTH_SHORT).show();
            }
        }
    }
}
