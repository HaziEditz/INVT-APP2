package com.khybertech.taxi360driver;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.support.v7.app.AppCompatActivity;
import android.support.v7.widget.Toolbar;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

import com.khybertech.taxi360driver.JobView.Fragments.appcontext;
import com.khybertech.taxi360driver.JobView.UpdateJob.SecurePreferences;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

public class UpdateProfileActivity extends AppCompatActivity {
    Toolbar toolbar_updateProfile;

    TextView spinner_country;
    String signIn_URL = "";// R.string.SignIn+"";
    String countryNames_URL="";//R.string.CountriesName+"";
    String updateProfile_URL="";//R.string.UpdatePassengerProfile+"";
    String companyid, usernamedriver, passworddriver,firstName,lastName,country,phoneNo,retrievedCountry,retrieveCountryCode, retrievedPNo;
    SecurePreferences sharedPreferences;
    SecurePreferences editor;
    TextView etxt_email,etxt_password,etxt_first_name,etxt_last_name,etxt_phone;
    Button btn_confirm;
    List<String> listForCountryNames;
    HashMap<Integer,String> hashMapForCountryCodes;
    int itemDisplayedCountrySpinner;
    AlertDialog dialogToUpdate;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_update_profile);
        widgets();
        toolbarMethod();

        listForCountryNames=new ArrayList<>();
        hashMapForCountryCodes=new HashMap<>();
//        sharedPreferences = PreferenceManager.getDefaultSharedPreferences(Singletonnotificationdata.getInstance().contxt);
        sharedPreferences = appcontext.getInstance().pref;
        editor = sharedPreferences;
        companyid =sharedPreferences.getString("companyIdForAutoLogin");
        usernamedriver =sharedPreferences.getString("usernameForAutoLogin");
        passworddriver =sharedPreferences.getString("passwordForAutoLogin");
        String drivername=sharedPreferences.getString("name");
        etxt_email.setText(usernamedriver);
        etxt_password.setText(passworddriver);
        etxt_first_name.setText(drivername);
        etxt_phone.setText(companyid);


        btn_confirm.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                finish();
            }
        });


    }

    public void widgets(){
        toolbar_updateProfile= (Toolbar) findViewById(R.id.toolbar_UpdateProfileActivity);
        spinner_country= (TextView) findViewById(R.id.spinner_country_updateProfile_activity);
        etxt_email= (TextView) findViewById(R.id.etxt_email_updateProfile_activity);
        etxt_password= (TextView) findViewById(R.id.etxt_password_updateProfile_activity);
        etxt_first_name= (TextView) findViewById(R.id.etxt_firstName_updateProfile_activity);
        etxt_phone= (TextView) findViewById(R.id.etxt_phoneNo_updateProfile_activity);
        btn_confirm= (Button) findViewById(R.id.btn_confirm_updateProfile_activity);
    }

    public void toolbarMethod(){
        setSupportActionBar(toolbar_updateProfile);
        getSupportActionBar().setTitle("Update Profile");
        toolbar_updateProfile.setNavigationIcon(R.mipmap.nav_back1);
        toolbar_updateProfile.setNavigationOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                onBackPressed();
            }
        });

    }

    @Override
    public void onBackPressed() {
        Intent i=new Intent(UpdateProfileActivity.this,MyAccountActivity.class);
        startActivity(i);
        UpdateProfileActivity.this.finish();
    }



}
